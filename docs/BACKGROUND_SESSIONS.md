# Background Sessions Architecture

> Daemonless approach to persistent sessions, inspired by Podman's container model.

## Problem Statement

Currently, switching sessions in openmux destroys all PTYs and recreates them from saved CWDs:

```
Session A (active) → PTYs alive, rendering
Session B (on disk) → serialized state only

[Switch to Session B]

Session A (on disk) → PTYs destroyed, state saved
Session B (active) → PTYs recreated from CWDs
```

**Issues:**

- Running processes are killed on session switch
- Long-running commands (builds, installs) are interrupted
- No detach/reattach capability (close terminal = lose everything)

## Solution: Daemonless Shim Architecture

Instead of a central daemon (tmux-style), use lightweight **shim processes** that hold PTYs and outlive the main TUI:

```
┌──────────────────────────────────────────────────────────────┐
│                        openmux (TUI)                         │
│                                                              │
│  ┌─────────────┐    Unix Socket     ┌─────────────────────┐  │
│  │ ShimClient  │◄──────────────────►│ Active Shim         │  │
│  │ Service     │                    │ (session-abc)       │  │
│  └─────────────┘                    └─────────────────────┘  │
└──────────────────────────────────────────────────────────────┘

Background (running independently):
┌──────────────────────────────────────────────────────────────┐
│  ~/.config/openmux/sockets/                                  │
│    ├── session-abc.sock  ← shim process listening            │
│    ├── session-def.sock  ← shim process listening            │
│    └── session-xyz.sock  ← shim process listening            │
└──────────────────────────────────────────────────────────────┘
```

## Shim Process

Each session runs in a minimal shim process (`openmux --shim <session-id>`):

```typescript
// Shim responsibilities:
// 1. Own PTYs for one session (spawn, hold file descriptors)
// 2. Run ghostty-vt emulator for terminal state
// 3. Listen on Unix socket for client connections
// 4. Stream PTY output to connected client
// 5. Buffer output when no client connected
// 6. Stay alive until explicitly killed or all PTYs exit
```

**Minimal footprint:** The shim uses conditional imports to avoid loading React, OpenTUI, and UI components—only the Effect runtime, Pty service, and socket server.

## Lifecycle

### Session Start

```
1. openmux spawns: openmux --shim session-abc
2. shim creates socket at ~/.config/openmux/sockets/session-abc.sock
3. shim spawns PTYs, initializes ghostty-vt emulators
4. openmux connects to socket via ShimClient service
5. shim streams terminal state, openmux renders
```

### Switch Session (Background Current)

```
1. openmux disconnects from shim-A socket
2. shim-A continues running, PTYs stay alive
3. shim-A buffers output (ghostty-vt emulator maintains state)
4. openmux connects to shim-B socket
5. shim-B sends terminal state snapshot + live stream
```

### Detach (Close Terminal)

```
1. openmux process exits (user closes terminal)
2. shim processes are orphaned → adopted by init (PID 1)
3. PTYs keep running, output buffered in emulators
4. Socket files remain for reattachment
```

### Reattach (New Terminal)

```
1. openmux starts, scans ~/.config/openmux/sockets/
2. Lists existing sessions from socket files
3. User selects session, openmux connects via ShimClient
4. shim sends full terminal state (replay)
5. Live streaming resumes
```

## Protocol Schema

Communication uses length-prefixed JSON with Effect Schema validation:

```typescript
import { Schema } from "effect"

// Server (Shim) → Client (TUI)
const ServerMessage = Schema.Union(
  // Full terminal state on connect/reconnect
  Schema.Struct({
    _tag: Schema.Literal("snapshot"),
    ptyId: PtyId,
    state: TerminalStateSchema,
    scrollback: Schema.Array(TerminalRowSchema),
  }),
  // Incremental PTY output
  Schema.Struct({
    _tag: Schema.Literal("output"),
    ptyId: PtyId,
    data: Schema.String,
  }),
  // PTY exited
  Schema.Struct({
    _tag: Schema.Literal("exit"),
    ptyId: PtyId,
    exitCode: Schema.Int,
  }),
  // PTY created (for dynamic views)
  Schema.Struct({
    _tag: Schema.Literal("created"),
    ptyId: PtyId,
    cols: Cols,
    rows: Rows,
    cwd: Schema.String,
  }),
)

// Client (TUI) → Server (Shim)
const ClientMessage = Schema.Union(
  // User input
  Schema.Struct({
    _tag: Schema.Literal("input"),
    ptyId: PtyId,
    data: Schema.String,
  }),
  // Terminal resize
  Schema.Struct({
    _tag: Schema.Literal("resize"),
    ptyId: PtyId,
    cols: Cols,
    rows: Rows,
  }),
  // Create new PTY in session
  Schema.Struct({
    _tag: Schema.Literal("create"),
    cols: Cols,
    rows: Rows,
    cwd: Schema.String,
  }),
  // Destroy PTY
  Schema.Struct({
    _tag: Schema.Literal("destroy"),
    ptyId: PtyId,
  }),
)
```

### Wire Format

```
[4 bytes: message length (big-endian)][JSON payload]
```

## Effect Services

### ShimClient Service

```typescript
class ShimClient extends Context.Tag("@openmux/ShimClient")<
  ShimClient,
  {
    // Spawn a new shim process for a session
    spawn: (sessionId: SessionId) => Effect<void, ShimSpawnError>

    // Connect to an existing shim
    connect: (sessionId: SessionId) => Effect<ShimConnection, ShimNotFoundError>

    // Disconnect (session goes to background)
    disconnect: (sessionId: SessionId) => Effect<void>

    // List running shims (scan socket directory)
    list: () => Effect<SessionId[]>

    // Kill a shim process
    kill: (sessionId: SessionId) => Effect<void>
  }
>() {}
```

### Pty Service Backend Swap

The existing `Pty` service interface remains unchanged. A new `shimLayer` routes operations through the socket:

```typescript
class Pty extends Context.Tag("@openmux/Pty")<Pty, PtyInterface>() {
  // Current: PTYs in-process
  static readonly directLayer = Layer.effect(...)

  // New: PTYs in shim process via socket
  static readonly shimLayer = Layer.effect(
    Pty,
    Effect.gen(function* () {
      const shim = yield* ShimClient

      return {
        create: (opts) => shim.send({ _tag: 'create', ...opts }),
        write: (id, data) => shim.send({ _tag: 'input', ptyId: id, data }),
        // ... delegate all operations to shim
      }
    })
  )
}
```

## Implementation Notes

### Socket Location

```
~/.config/openmux/sockets/
├── session-{uuid}.sock      # Per-session shim socket
└── .lock                    # Optional: prevent duplicate TUIs
```

### Shim Entry Point

```typescript
// src/index.ts
if (process.argv.includes('--shim')) {
  // Minimal path - skip UI, only load PTY + socket
  const { runShim } = await import('./shim/main')
  const sessionId = process.argv[process.argv.indexOf('--shim') + 1]
  await runShim(sessionId)
  process.exit(0)
}

// Full TUI path
const { runApp } = await import('./app/main')
await runApp()
```

### Orphan Cleanup

On startup, openmux should:

1. Scan socket directory for existing shims
2. Verify each socket is connectable (shim still alive)
3. Remove stale socket files from crashed shims

## Why Effect?

The shim architecture itself doesn't require Effect—it's achievable with vanilla TypeScript. However, Effect provides:

1. **Schema validation** for protocol messages (already using Effect)
2. **Layer abstraction** to swap `directLayer` ↔ `shimLayer` transparently
3. **Scope management** for socket connection lifecycle
4. **Foundation for aggregate views** (see AGGREGATE_VIEWS.md)

Since openmux already uses Effect for services, the shim architecture integrates naturally.
