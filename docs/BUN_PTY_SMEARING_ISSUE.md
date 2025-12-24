# bun-pty Smearing Issue

## Summary

High-frequency terminal animations (e.g., spinning color wheels, rapid cursor movements) exhibit visual "smearing" artifacts when rendered through bun-pty. This is a limitation of bun-pty's read loop implementation, **not** OpenTUI or libghostty-vt.

## Symptoms

- Single cells appear to "lag behind" during animations
- Colors from previous frames briefly persist in wrong positions
- Most noticeable with 60fps animations outputting many ANSI sequences per frame

## Root Cause

### Confirmed Through Isolation Testing

| Test | Result |
|------|--------|
| `python3 scripts/spinner.py` (direct execution) | **No smearing** |
| `bun scripts/test-pty-passthrough.ts` (bun-pty → stdout, no ghostty/OpenTUI) | **Smears** |
| `bun scripts/test-direct-stdout.ts` (bun-pty → ghostty-vt → stdout, no OpenTUI) | **Smears** |
| Various OpenTUI rendering approaches | **All smear** (when using bun-pty) |

This definitively proves the issue originates in bun-pty, not in the rendering pipeline.

### Technical Details

The issue is in bun-pty's read loop (`node_modules/bun-pty/dist/index.js:167-186`):

```javascript
async _startReadLoop() {
  const buf = Buffer.allocUnsafe(4096);  // Small fixed buffer
  while (this._readLoop && !this._closing) {
    const n = lib.symbols.bun_pty_read(this.handle, ptr(buf), buf.length);
    if (n > 0) {
      this._onData.fire(buf.subarray(0, n).toString("utf8"));  // Immediate fire
    } else if (n === -2) {
      // ... exit handling
    } else {
      await new Promise((r) => setTimeout(r, 8));  // 8ms polling
    }
  }
}
```

**Problems**:
1. **4096-byte buffer**: High-volume output (spinner outputs ~700 ANSI sequences per frame, ~20KB+ of data) gets fragmented across multiple reads
2. **Immediate firing**: Each read chunk triggers `onData` immediately, potentially mid-frame
3. **8ms polling gap**: Creates timing inconsistencies between reads

### Why Direct Execution Works

When Python writes directly to stdout:
- Output goes through the kernel's TTY layer with proper buffering
- The terminal receives complete frames atomically
- No intermediate chunking by a read loop

When going through bun-pty:
- Python writes to PTY slave
- bun-pty's Rust library reads from PTY master in chunks
- Chunks are delivered to JS via FFI, each triggering `onData`
- Frame data is fragmented across multiple events

## Attempted Workarounds (Failed)

1. **Batching PTY data with setTimeout** - Doesn't help; the fragmentation happens at the FFI/Rust level
2. **Buffering incomplete escape sequences** - Doesn't address the timing issue
3. **Various OpenTUI rendering modes** - Issue is upstream of OpenTUI

## Alternatives Investigated

| Alternative | Status |
|-------------|--------|
| node-pty | Incompatible with Bun (V8/libuv API mismatch) |
| @zenyr/bun-pty | Same underlying portable-pty library |
| Bun native PTY | Not available yet |

## Impact

- Affects any high-frequency terminal animations in openmux
- Low-frequency updates (normal shell usage, text editors) are unaffected
- The smearing is cosmetic and doesn't affect functionality

## Potential Solutions

### Short-term
- Document as known limitation
- Consider reducing animation frame rates where possible

### Medium-term
- Fork bun-pty and modify the Rust read loop:
  - Increase buffer size (e.g., 64KB)
  - Add optional batching/debouncing at the Rust level
  - Implement frame-aware buffering

### Long-term
- File issue with bun-pty upstream
- Monitor Bun's progress on native PTY support
- Contribute fixes back to bun-pty

## Test Scripts

The following scripts were created during investigation:

- `scripts/spinner.py` - Direct Python spinner (baseline, no smearing)
- `scripts/test-pty-passthrough.ts` - Raw bun-pty to stdout (smears)
- `scripts/test-direct-stdout.ts` - bun-pty + ghostty-vt, no OpenTUI (smears)
- `scripts/test-batched-pty-clean.ts` - Batching attempt (still smears)

## References

- [node-pty Bun support issue](https://github.com/microsoft/node-pty/issues/632)
- [portable-pty (underlying Rust library)](https://github.com/wez/wezterm/tree/main/pty)
- bun-pty version tested: 0.4.2
