# Patches

## bun-pty@0.4.2.patch

Fixes visual "smearing/artifacting" during high-frequency terminal animations.

### Root Cause

The original `bun-pty` uses `.toString("utf8")` to convert PTY output bytes to strings. When the OS kernel splits PTY data mid-UTF-8 character (which happens at arbitrary byte boundaries), this produces Unicode replacement characters (U+FFFD, displayed as �) that briefly appear as visual artifacts.

### The Fix

Uses a **streaming TextDecoder** that buffers incomplete UTF-8 sequences:

```javascript
// Before (broken):
const data = buf.subarray(0, n).toString("utf8");

// After (fixed):
this._decoder = new TextDecoder("utf-8", { fatal: false });
const data = this._decoder.decode(buf.subarray(0, n), { stream: true });
```

The `{ stream: true }` option tells TextDecoder to:
1. Decode complete UTF-8 sequences normally
2. Buffer trailing incomplete bytes internally
3. Prepend buffered bytes to the next decode() call

This ensures we never emit invalid/replacement characters to the terminal emulator.

### Additional Changes

- Buffer size increased to 64KB for better throughput
- Uses `setImmediate` instead of `setTimeout(8)` for more responsive polling
- Flushes remaining decoder buffer on process exit

## Optional: Rust Optimization

The `bun-pty-rust/` directory contains an optimized Rust binary that drains all available PTY data in one FFI call (reduces round-trips). This is a **performance optimization only** - the smearing fix is entirely in the JS patch.

To use the optimized Rust binary on macOS ARM64:

```bash
cp patches/bun-pty-rust/librust_pty_darwin_arm64.dylib \
   node_modules/bun-pty/rust-pty/target/release/librust_pty.dylib
```

To build from source for other platforms, see `/tmp/bun-pty-patch/` or the snapshot at `/tmp/bun-pty-patch/snapshots/v39-working/`.
