# Shim Upgrade RPC (Hot Upgrade)

## Goal
Allow upgrading the background shim process without killing PTYs, while keeping the
client (UI) attachable during or after the upgrade.

## Non-Goals
- Live migration between hosts.
- Multi-client support (still single active client).
- Perfect visual continuity for interactive programs if we do not snapshot emulator
  state.

## Constraints
- PTY masters are owned by the shim. They must remain open across upgrades.
- The shim owns emulator state (screen buffer + scrollback) via native emulator.
- Current protocol has no version negotiation or capabilities exchange.
- Bun/Node do not expose native SCM_RIGHTS helpers; we may need a helper in Zig
  (or a small native bridge) to pass FDs.

## Protocol Additions
1) **Hello / capabilities**
   - Client sends: `hello { clientId, version, capabilities }`
   - Shim replies: `helloResult { pid, protocolVersion, capabilities }`
   - If incompatible, shim returns explicit error: `Incompatible protocol`.

2) **Upgrade RPC** (conceptual)
   - `upgrade.prepare { targetVersion, requireState: boolean }`
     - Freezes input, drains updates, returns `upgradeToken`.
   - `upgrade.snapshot { upgradeToken }`
     - Returns serialized terminal state and metadata.
   - `upgrade.commit { upgradeToken }`
     - Old shim stops accepting new clients and awaits handoff completion.
   - `upgrade.abort { upgradeToken }`
     - Resume normal operation.

## Handoff Strategy Options
### Option A: FD Handoff (Preferred)
- Old shim spawns new shim (same binary or new path) with a control socket.
- Old shim passes PTY master FDs via SCM_RIGHTS to new shim.
- New shim reconstructs PTYs using `zig-pty` import-from-fd API.
- Old shim exits after confirmation from new shim.

### Option B: External Broker (Fallback)
- A small native broker (or Zig helper) holds the PTY FDs.
- Broker spawns the new shim and transfers FDs.
- Shim upgrade becomes a broker operation rather than self-handoff.

## Emulator State Migration
To preserve on-screen buffer and scrollback:
- Add `exportState()` in emulators (full buffer + scrollback + cursor + modes).
- Add `importState()` to seed a fresh emulator after upgrade.
- If this is too heavy, accept scrollback loss for v1 of hot upgrade.

## Upgrade Flow (Option A)
1) Client requests `upgrade.prepare`.
2) Shim freezes input and drains updates to a quiescent point.
3) Shim snapshots emulator state (optional) and persists metadata in memory.
4) Shim spawns new shim and passes PTY master FDs + snapshot via control socket.
5) New shim reconstructs PTYs, restores emulator state, replays last frame.
6) New shim binds the standard shim socket and signals readiness.
7) Old shim exits.
8) Client reconnects and reattaches.

## Client Behavior
- On `upgrade.prepare` success, client displays a short "upgrading" overlay.
- If reconnect fails, client retries until timeout and shows an upgrade failure message.
- Client should accept a shim with a newer `protocolVersion` if compatible.

## Compatibility and Safety
- Introduce `protocolVersion` with semver-like compatibility rules.
- Gate upgrade behind a capability flag (e.g., `hotUpgrade=true`).
- If upgrade fails, old shim should resume normal operation (abort path).

## Risks
- FD handoff is OS-specific; needs careful testing on macOS + Linux.
- Emulator snapshots can be large; memory spikes during upgrade are expected.
- Input freeze must be explicit to avoid corrupt state.

## Minimal Viable Upgrade (Phase 1)
- FD handoff only; no emulator state migration (scrollback loss acceptable).
- Explicit compatibility check in hello.
- Upgrade command available only when client is attached.
