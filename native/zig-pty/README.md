# zig-pty

A pure Zig PTY implementation for Bun - minimal and high-performance.

## Features

- **Pure Zig** - No external dependencies, just POSIX syscalls
- **Tiny** - ~53KB release binary (vs ~570KB for Rust-based alternatives)
- **Fast** - Direct syscalls, no overhead
- **Compatible** - Drop-in replacement for bun-pty

## Installation

```bash
# Build the Zig library
zig build -Doptimize=ReleaseFast

# Build the TypeScript wrapper
bun build ./src/index.ts --outdir ./dist --target bun
```

## Usage

```typescript
import { Terminal, spawn } from "zig-pty";

// Option 1: Using Terminal class directly
const term = new Terminal("bash", [], {
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
});

term.onData((data) => {
  console.log(data);
});

term.onExit(({ exitCode }) => {
  console.log(`Exited with code ${exitCode}`);
});

term.write("echo hello\n");

// Option 2: Using spawn function
const term2 = spawn("bash", [], { cols: 80, rows: 24 });
```

## API

### `Terminal(file, args, options)`

Creates a new pseudoterminal.

- `file` - The program to run (default: "sh")
- `args` - Arguments to pass to the program
- `options` - Terminal options:
  - `cols` - Number of columns (default: 80)
  - `rows` - Number of rows (default: 24)
  - `cwd` - Working directory
  - `env` - Additional environment variables

### Properties

- `pid` - Process ID of the child
- `cols` - Current column count
- `rows` - Current row count

### Methods

- `write(data: string)` - Write data to the terminal
- `resize(cols: number, rows: number)` - Resize the terminal
- `kill(signal?: string)` - Kill the child process

### Events

- `onData(callback)` - Called when data is received
- `onExit(callback)` - Called when the process exits

## UTF-8 Handling

zig-pty uses a streaming TextDecoder to properly handle UTF-8 sequences that may be split across reads. This prevents the "smearing" artifacts that can occur with naive `.toString("utf8")` approaches.

## Building

Requires Zig 0.11+ and Bun 1.0+.

```bash
# Development build
zig build

# Release build
zig build -Doptimize=ReleaseFast

# Run tests
zig build test
```

## Cross-compilation

Zig makes cross-compilation trivial:

```bash
# Linux x86_64
zig build -Doptimize=ReleaseFast -Dtarget=x86_64-linux

# Linux ARM64
zig build -Doptimize=ReleaseFast -Dtarget=aarch64-linux
```

## License

MIT
