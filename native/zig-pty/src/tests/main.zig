//! zig-pty Test Suite
//!
//! This module imports all test modules to run the complete test suite.
//! Tests are organized by functionality:
//!
//! - pty_tests.zig: Basic PTY spawn, read, write, resize, kill, exit code
//! - async_spawn_tests.zig: Asynchronous PTY spawning with polling
//! - process_info_tests.zig: Process inspection (CWD, process name, foreground PID)
//! - ring_buffer_tests.zig: Lock-free SPSC ring buffer operations
//! - safety_tests.zig: UAF prevention, concurrent access, handle reuse
//! - validation_tests.zig: Input validation, invalid handles/dimensions

// Import all test modules - this causes their tests to be discovered
comptime {
    _ = @import("pty_tests.zig");
    _ = @import("async_spawn_tests.zig");
    _ = @import("process_info_tests.zig");
    _ = @import("ring_buffer_tests.zig");
    _ = @import("safety_tests.zig");
    _ = @import("validation_tests.zig");
}
