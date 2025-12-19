//! Shared constants for zig-pty

pub const SUCCESS: c_int = 0;
pub const ERROR: c_int = -1;
pub const CHILD_EXITED: c_int = -2;
pub const SPAWN_PENDING: c_int = -3;
pub const SPAWN_ERROR: c_int = -4;

pub const MAX_HANDLES: usize = 256;
pub const MAX_SPAWN_REQUESTS: usize = 64;
pub const MAX_CMD_LEN: usize = 8192;
pub const MAX_CWD_LEN: usize = 4096;
pub const MAX_ENV_LEN: usize = 65536;
