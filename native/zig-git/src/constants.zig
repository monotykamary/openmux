pub const ERROR: c_int = -1;
pub const DIFF_PENDING: c_int = -3;
pub const DIFF_ERROR: c_int = -4;
pub const STATUS_PENDING: c_int = -5;
pub const STATUS_ERROR: c_int = -6;
pub const STATUS_UNKNOWN: c_int = -1;

pub const MAX_CWD_LEN: usize = 4096;
pub const MAX_DIFF_REQUESTS: usize = 64;
pub const MAX_STATUS_REQUESTS: usize = 64;
pub const MAX_BRANCH_LEN: usize = 256;
