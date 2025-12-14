//! lib.rs — bun-pty backend (v38: minimal, no background thread)
//!
//! First principles approach: Remove all complexity.
//! Just do direct non-blocking reads from the PTY fd.
//! No background thread, no channel, no batching.

use portable_pty::{
    native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize, SlavePty,
};
use serde::{Deserialize, Serialize};
use shell_words::split;
use std::{
    collections::HashMap,
    ffi::CStr,
    io::Write,
    os::raw::{c_char, c_int},
    sync::{
        atomic::{AtomicBool, AtomicI32, Ordering},
        Arc, Mutex,
    },
    thread,
};

#[cfg(unix)]
use std::os::unix::io::RawFd;

/* ---------- constants ---------- */

const SUCCESS: c_int = 0;
const ERROR: c_int = -1;
const CHILD_EXITED: c_int = -2;

/* ---------- helpers ---------- */

fn debug(msg: &str) {
    if std::env::var("BUN_PTY_DEBUG").unwrap_or_default() == "1" {
        eprintln!("[rust-pty] {msg}");
    }
}

#[cfg(unix)]
fn set_nonblocking(fd: RawFd) -> bool {
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFL);
        if flags < 0 {
            return false;
        }
        libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) >= 0
    }
}

fn parse_env_string(env_ptr: *const c_char) -> HashMap<String, String> {
    if env_ptr.is_null() {
        return HashMap::new();
    }
    let mut env_map = HashMap::new();
    let mut current_ptr = env_ptr;
    unsafe {
        while *current_ptr != 0 {
            let cstr = CStr::from_ptr(current_ptr);
            if let Ok(env_str) = cstr.to_str() {
                if let Some((key, value)) = env_str.split_once('=') {
                    if !key.is_empty() {
                        env_map.insert(key.to_string(), value.to_string());
                    }
                }
            }
            current_ptr = current_ptr.add(cstr.to_bytes_with_nul().len());
        }
    }
    env_map
}

/* ---------- Command wrapper ---------- */

#[derive(Clone, Serialize, Deserialize)]
struct Command {
    prog: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
}

impl Command {
    fn to_builder(&self) -> CommandBuilder {
        let mut b = CommandBuilder::new(&self.prog);
        b.args(&self.args);
        if let Some(ref dir) = self.cwd {
            b.cwd(dir);
        }
        if let Some(ref env_map) = self.env {
            for (k, v) in env_map {
                b.env(k, v);
            }
        }
        b
    }
}

/* ---------- PTY handle ---------- */

struct Pty {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    _slave: Box<dyn SlavePty + Send>,
    _master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    exited: AtomicBool,
    exit_code: AtomicI32,
    pid: c_int,
    // File descriptor for direct reads
    #[cfg(unix)]
    read_fd: RawFd,
}

unsafe impl Send for Pty {}
unsafe impl Sync for Pty {}

impl Pty {
    fn new(cmd: Command, size: PtySize) -> Result<Arc<Self>, Box<dyn std::error::Error + Send + Sync>> {
        let sys = native_pty_system();
        let pair = sys.openpty(size)?;
        let mut child = pair.slave.spawn_command(cmd.to_builder())?;
        let killer = Arc::new(Mutex::new(child.clone_killer()));
        let pid = child.process_id().map(|p| p as c_int).unwrap_or(ERROR);

        let master = Arc::new(Mutex::new(pair.master));
        let writer = Arc::new(Mutex::new(master.lock().unwrap().take_writer()?));

        // Get fd for direct reads
        #[cfg(unix)]
        let read_fd = {
            let reader = master.lock().unwrap().try_clone_reader()?;
            use std::io::Read;
            let rdr_ref: &dyn Read = &*reader;
            let extracted_fd: i32 = unsafe {
                let (data_ptr, _vtable): (*const u8, *const u8) =
                    std::mem::transmute(rdr_ref);
                *(data_ptr as *const i32)
            };

            // Dup the fd so it survives reader drop
            let dup_fd = unsafe { libc::dup(extracted_fd) };
            if dup_fd < 0 {
                return Err("Failed to dup fd".into());
            }

            // Set non-blocking
            if !set_nonblocking(dup_fd) {
                unsafe { libc::close(dup_fd) };
                return Err("Failed to set non-blocking".into());
            }

            debug(&format!("PTY fd={} set to non-blocking", dup_fd));
            dup_fd
        };

        let pty = Arc::new(Self {
            writer,
            _slave: pair.slave,
            _master: master,
            killer,
            exited: AtomicBool::new(false),
            exit_code: AtomicI32::new(-1),
            pid,
            #[cfg(unix)]
            read_fd,
        });

        // Spawn wait thread for child exit
        {
            let pty_clone = pty.clone();

            thread::spawn(move || {
                let status = child.wait();
                if let Ok(exit_status) = status {
                    let code = exit_status.exit_code() as i32;
                    pty_clone.exit_code.store(code, Ordering::SeqCst);
                }
                pty_clone.exited.store(true, Ordering::SeqCst);
                debug("Child process exited");
            });
        }

        Ok(pty)
    }

    #[cfg(unix)]
    fn read_available(&self, out_buf: &mut [u8]) -> c_int {
        if self.exited.load(Ordering::SeqCst) {
            return CHILD_EXITED;
        }

        // Drain all available data in one FFI call (reduces round-trips)
        let mut total = 0usize;

        loop {
            let remaining = &mut out_buf[total..];
            if remaining.is_empty() {
                break; // Buffer full
            }

            let n = unsafe {
                libc::read(
                    self.read_fd,
                    remaining.as_mut_ptr() as *mut libc::c_void,
                    remaining.len(),
                )
            };

            if n > 0 {
                total += n as usize;
                // Continue to drain more if available
            } else if n == 0 {
                // EOF
                break;
            } else {
                // n < 0, check errno
                let err = std::io::Error::last_os_error();
                if err.kind() == std::io::ErrorKind::WouldBlock {
                    // No more data available
                    break;
                } else if err.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                } else {
                    // Real error
                    debug(&format!("Read error: {}", err));
                    if total > 0 {
                        break; // Return what we have
                    }
                    return ERROR;
                }
            }
        }

        if total > 0 {
            total as c_int
        } else if self.exited.load(Ordering::SeqCst) {
            CHILD_EXITED
        } else {
            0
        }
    }

    fn write(&self, data: &[u8]) -> c_int {
        if self.exited.load(Ordering::SeqCst) {
            return CHILD_EXITED;
        }
        match self.writer.lock().unwrap().write_all(data) {
            Ok(_) => {
                let _ = self.writer.lock().unwrap().flush();
                SUCCESS
            }
            Err(_) => ERROR,
        }
    }

    fn resize(&self, size: PtySize) -> c_int {
        if let Err(e) = self._master.lock().unwrap().resize(size) {
            debug(&format!("Resize error: {}", e));
            return ERROR;
        }
        SUCCESS
    }

    fn kill(&self) -> c_int {
        if let Err(e) = self.killer.lock().unwrap().kill() {
            debug(&format!("Kill error: {}", e));
            return ERROR;
        }
        SUCCESS
    }
}

impl Drop for Pty {
    fn drop(&mut self) {
        #[cfg(unix)]
        unsafe {
            libc::close(self.read_fd);
        }
    }
}

/* ---------- Handle registry ---------- */

lazy_static::lazy_static! {
    static ref REG: Mutex<HashMap<u32, Arc<Pty>>> = Mutex::new(HashMap::new());
    static ref NEXT_ID: AtomicI32 = AtomicI32::new(1);
}

fn insert(p: Arc<Pty>) -> u32 {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed) as u32;
    REG.lock().unwrap().insert(id, p);
    id
}

fn with<F, R>(h: u32, f: F) -> R
where
    F: FnOnce(&Arc<Pty>) -> R,
    R: Default,
{
    REG.lock()
        .unwrap()
        .get(&h)
        .map(f)
        .unwrap_or_default()
}

/* ---------- FFI exports ---------- */

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_pty_spawn(
    cmd: *const c_char,
    cwd: *const c_char,
    env: *const c_char,
    cols: c_int,
    rows: c_int,
) -> c_int {
    let cmdline = CStr::from_ptr(cmd).to_string_lossy();
    let cwd = CStr::from_ptr(cwd).to_string_lossy();
    let args = match split(&cmdline) {
        Ok(v) if !v.is_empty() => v,
        _ => return ERROR,
    };
    let (prog, rest) = args.split_first().unwrap();
    let env_map = parse_env_string(env);
    let size = PtySize {
        cols: cols as u16,
        rows: rows as u16,
        pixel_width: 0,
        pixel_height: 0,
    };
    let command = Command {
        prog: prog.clone(),
        args: rest.to_vec(),
        cwd: if cwd.is_empty() { None } else { Some(cwd.into_owned()) },
        env: if env_map.is_empty() { None } else { Some(env_map) },
    };

    match Pty::new(command, size) {
        Ok(pty) => insert(pty) as c_int,
        Err(e) => {
            debug(&format!("Spawn error: {}", e));
            ERROR
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_pty_write(handle: c_int, data: *const u8, len: c_int) -> c_int {
    if handle <= 0 || data.is_null() || len <= 0 {
        return ERROR;
    }
    let slice = std::slice::from_raw_parts(data, len as usize);
    with(handle as u32, |p| p.write(slice))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bun_pty_read(handle: c_int, buf: *mut u8, len: c_int) -> c_int {
    if handle <= 0 || buf.is_null() || len <= 0 {
        return ERROR;
    }

    #[cfg(unix)]
    {
        let out_buf = std::slice::from_raw_parts_mut(buf, len as usize);
        with(handle as u32, |p| p.read_available(out_buf))
    }

    #[cfg(not(unix))]
    {
        ERROR
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn bun_pty_resize(handle: c_int, cols: c_int, rows: c_int) -> c_int {
    if handle <= 0 || cols <= 0 || rows <= 0 {
        return ERROR;
    }
    with(handle as u32, |p| {
        p.resize(PtySize {
            cols: cols as u16,
            rows: rows as u16,
            pixel_width: 0,
            pixel_height: 0,
        })
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn bun_pty_kill(handle: c_int) -> c_int {
    if handle <= 0 {
        return ERROR;
    }
    with(handle as u32, |p| p.kill())
}

#[unsafe(no_mangle)]
pub extern "C" fn bun_pty_get_pid(handle: c_int) -> c_int {
    if handle <= 0 {
        return ERROR;
    }
    with(handle as u32, |p| p.pid)
}

#[unsafe(no_mangle)]
pub extern "C" fn bun_pty_get_exit_code(handle: c_int) -> c_int {
    if handle <= 0 {
        return ERROR;
    }
    with(handle as u32, |p| p.exit_code.load(Ordering::SeqCst))
}

#[unsafe(no_mangle)]
pub extern "C" fn bun_pty_close(handle: c_int) {
    if handle <= 0 {
        return;
    }
    REG.lock().unwrap().remove(&(handle as u32));
}
