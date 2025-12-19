/**
 * Native process utilities - avoids subprocess spawning for process inspection.
 * Uses FFI on macOS (libproc) and direct /proc reads on Linux.
 */

import { dlopen, FFIType, ptr } from "bun:ffi";
import { readlink, readFile } from "fs/promises";

// =============================================================================
// Platform Detection
// =============================================================================

const platform = process.platform;
const isMacOS = platform === "darwin";
const isLinux = platform === "linux";

// =============================================================================
// macOS - libproc FFI bindings
// =============================================================================

interface LibProc {
  proc_pidinfo: (
    pid: number,
    flavor: number,
    arg: number,
    buffer: Uint8Array,
    bufferSize: number
  ) => number;
  proc_listpids: (
    type: number,
    typeinfo: number,
    buffer: Uint8Array | null,
    bufferSize: number
  ) => number;
}

let libproc: LibProc | null = null;

// Lazy-load libproc on macOS
function getLibProc(): LibProc | null {
  if (!isMacOS) return null;
  if (libproc) return libproc;

  try {
    const lib = dlopen("libproc.dylib", {
      proc_pidinfo: {
        args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32],
        returns: FFIType.i32,
      },
      proc_listpids: {
        args: [FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.i32],
        returns: FFIType.i32,
      },
    });

    libproc = {
      proc_pidinfo: (pid, flavor, arg, buffer, bufferSize) =>
        lib.symbols.proc_pidinfo(pid, flavor, arg, ptr(buffer), bufferSize) as number,
      proc_listpids: (type, typeinfo, buffer, bufferSize) =>
        lib.symbols.proc_listpids(type, typeinfo, buffer ? ptr(buffer) : null, bufferSize) as number,
    };

    return libproc;
  } catch {
    return null;
  }
}

// =============================================================================
// Constants
// =============================================================================

// macOS proc_pidinfo flavors
const PROC_PIDVNODEPATHINFO = 9;
const PROC_PIDVNODEPATHINFO_SIZE = 2352; // sizeof(struct proc_vnodepathinfo)

// Offset of vip_path (cwd path) in proc_vnodepathinfo struct
// struct vnode_info_path is at offset 152, and vi_path is at the start
const VIP_PATH_OFFSET = 152;
const MAXPATHLEN = 1024;

// =============================================================================
// Get Process CWD
// =============================================================================

/**
 * Get the current working directory of a process by PID.
 * Uses native APIs instead of spawning subprocesses.
 *
 * macOS: libproc proc_pidinfo with PROC_PIDVNODEPATHINFO
 * Linux: readlink /proc/<pid>/cwd
 */
export async function getProcessCwdNative(pid: number): Promise<string | null> {
  if (isMacOS) {
    return getProcessCwdMacOS(pid);
  } else if (isLinux) {
    return getProcessCwdLinux(pid);
  }
  return null;
}

function getProcessCwdMacOS(pid: number): string | null {
  const lib = getLibProc();
  if (!lib) return null;

  try {
    const buffer = new Uint8Array(PROC_PIDVNODEPATHINFO_SIZE);
    const result = lib.proc_pidinfo(
      pid,
      PROC_PIDVNODEPATHINFO,
      0,
      buffer,
      PROC_PIDVNODEPATHINFO_SIZE
    );

    if (result <= 0) return null;

    // Extract cwd path from the struct
    // The path is a null-terminated string at VIP_PATH_OFFSET
    const pathBytes = buffer.slice(VIP_PATH_OFFSET, VIP_PATH_OFFSET + MAXPATHLEN);
    const nullIndex = pathBytes.indexOf(0);
    const path = new TextDecoder().decode(
      nullIndex >= 0 ? pathBytes.slice(0, nullIndex) : pathBytes
    );

    return path || null;
  } catch {
    return null;
  }
}

async function getProcessCwdLinux(pid: number): Promise<string | null> {
  try {
    return await readlink(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

// =============================================================================
// Get Foreground Process
// =============================================================================

/**
 * Get the foreground process name for a shell PID.
 * Uses native APIs instead of spawning pgrep/ps.
 *
 * macOS: libproc to list child processes and get their names
 * Linux: read /proc/<pid>/task/<pid>/children and /proc/<child>/comm
 */
export async function getForegroundProcessNative(
  shellPid: number
): Promise<string | null> {
  if (isMacOS) {
    return getForegroundProcessMacOS(shellPid);
  } else if (isLinux) {
    return getForegroundProcessLinux(shellPid);
  }
  return null;
}

function getForegroundProcessMacOS(shellPid: number): string | null {
  const lib = getLibProc();
  if (!lib) return null;

  try {
    // Get all PIDs first to find children of shellPid
    // PROC_ALL_PIDS = 1
    const pidCount = lib.proc_listpids(1, 0, null, 0) / 4;
    if (pidCount <= 0) return null;

    const pidBuffer = new Uint8Array(pidCount * 4);
    const actualCount = lib.proc_listpids(1, 0, pidBuffer, pidBuffer.length) / 4;

    // Convert to array of PIDs
    const view = new DataView(pidBuffer.buffer);
    const pids: number[] = [];
    for (let i = 0; i < actualCount; i++) {
      const pid = view.getInt32(i * 4, true);
      if (pid > 0) pids.push(pid);
    }

    // Find children of shellPid by checking their PPID
    // We need to use proc_pidinfo with PROC_PIDTASKINFO to get PPID
    const PROC_PIDTBSDINFO = 3;
    const PROC_PIDTBSDINFO_SIZE = 304;
    const PPID_OFFSET = 24; // Offset of pbi_ppid in proc_bsdinfo

    const childPids: number[] = [];
    const infoBuffer = new Uint8Array(PROC_PIDTBSDINFO_SIZE);

    for (const pid of pids) {
      const result = lib.proc_pidinfo(
        pid,
        PROC_PIDTBSDINFO,
        0,
        infoBuffer,
        PROC_PIDTBSDINFO_SIZE
      );
      if (result > 0) {
        const ppid = new DataView(infoBuffer.buffer).getUint32(PPID_OFFSET, true);
        if (ppid === shellPid) {
          childPids.push(pid);
        }
      }
    }

    if (childPids.length === 0) {
      // No children, return shell name
      return getProcessNameMacOS(shellPid);
    }

    // Get the most recent child (highest PID, approximation)
    const lastChild = Math.max(...childPids);
    return getProcessNameMacOS(lastChild);
  } catch {
    return null;
  }
}

function getProcessNameMacOS(pid: number): string | null {
  const lib = getLibProc();
  if (!lib) return null;

  try {
    const PROC_PIDTBSDINFO = 3;
    const PROC_PIDTBSDINFO_SIZE = 304;
    const COMM_OFFSET = 92; // Offset of pbi_comm in proc_bsdinfo
    const MAXCOMLEN = 16;

    const buffer = new Uint8Array(PROC_PIDTBSDINFO_SIZE);
    const result = lib.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, buffer, PROC_PIDTBSDINFO_SIZE);

    if (result <= 0) return null;

    const commBytes = buffer.slice(COMM_OFFSET, COMM_OFFSET + MAXCOMLEN);
    const nullIndex = commBytes.indexOf(0);
    const name = new TextDecoder().decode(
      nullIndex >= 0 ? commBytes.slice(0, nullIndex) : commBytes
    );

    return name || null;
  } catch {
    return null;
  }
}

async function getForegroundProcessLinux(shellPid: number): Promise<string | null> {
  try {
    // Try to read children directly
    let childPids: number[] = [];
    try {
      const children = await readFile(
        `/proc/${shellPid}/task/${shellPid}/children`,
        "utf-8"
      );
      childPids = children
        .trim()
        .split(" ")
        .filter(Boolean)
        .map(Number);
    } catch {
      // children file may not exist or be empty
    }

    if (childPids.length === 0) {
      // No children, return shell name
      return getProcessNameLinux(shellPid);
    }

    // Get the most recent child (highest PID)
    const lastChild = Math.max(...childPids);
    return getProcessNameLinux(lastChild);
  } catch {
    return null;
  }
}

async function getProcessNameLinux(pid: number): Promise<string | null> {
  try {
    const comm = await readFile(`/proc/${pid}/comm`, "utf-8");
    return comm.trim() || null;
  } catch {
    return null;
  }
}

// =============================================================================
// Get Git Branch (direct file read)
// =============================================================================

/**
 * Get the current git branch by reading .git/HEAD directly.
 * No subprocess spawning needed!
 */
export async function getGitBranchNative(cwd: string): Promise<string | null> {
  try {
    // First, check if .git/HEAD exists
    const headPath = `${cwd}/.git/HEAD`;
    const head = await readFile(headPath, "utf-8");

    // HEAD contains either:
    // "ref: refs/heads/branch-name\n" (on a branch)
    // "abc123...\n" (detached HEAD, commit hash)

    const refMatch = head.match(/^ref: refs\/heads\/(.+)/);
    if (refMatch) {
      return refMatch[1].trim();
    }

    // Detached HEAD - return short hash
    const hash = head.trim();
    if (hash.length >= 7) {
      return hash.substring(0, 7);
    }

    return null;
  } catch {
    // Not a git repo or can't read .git/HEAD
    return null;
  }
}

