# Openmux Stability Fixes Analysis

This document explains the stability work done after comparing openmux with tmux and zellij test practices. Each topic is explained first in layman terms, then in technical terms.

## Layman Explanation

### 1. Shim Client Requests Could Hang Forever

Openmux has a background helper process called the shim. The main app talks to it over a local socket, similar to calling a small local service and waiting for an answer.

Before this fix, if openmux asked the shim a question and the connection disappeared before the shim answered, openmux could keep waiting forever. That is like calling someone, the phone line drops, and your phone still acts like the call is ongoing.

This is dangerous for stability because one lost response can freeze a feature that is waiting for it. Detach, attach, pane metadata, terminal state, or shutdown flows can all depend on these request/response calls.

The fix makes every request finish one way or another. If the socket closes, the request fails clearly. If the write fails, the request fails clearly. If the shim explicitly detaches the client, pending requests fail clearly. If the shim never answers within a reasonable time, the request times out.

The important behavioral change is this: openmux now fails fast instead of silently hanging.

Files involved:

`src/shim/client/connection.ts`

Tests involved:

`tests/shim/connection-lifecycle.test.ts`

### 2. Normal Socket Close Was Treated Like Permanent Detach

Openmux supports detach/attach behavior. One client can be actively attached to the shim, and another client can take over. When that happens, the old client receives an explicit detached message.

Before this fix, any socket close was treated as if the shim had permanently detached the client. That means a normal connection drop, shim restart, or harmless close could put the client into a state where it would refuse to reconnect.

That is like your Wi-Fi disconnecting once and the app deciding you are permanently banned from reconnecting.

The fix separates two different events:

Plain socket close means the connection is gone, but reconnecting is allowed.

Explicit detached event means the shim intentionally revoked this client, so the client should stop reconnecting as that same active owner.

This improves stability because transient socket failures no longer permanently break the client.

Files involved:

`src/shim/client/connection.ts`

Tests involved:

`tests/shim/connection-lifecycle.test.ts`

### 3. Protocol Readers Could Crash On Bad Frames

Openmux sends messages through sockets using framed data. A frame is a small package containing a JSON header and optional binary data.

Before this fix, if the app received a malformed frame, the parser could throw an exception. In practical terms, one bad or partial-looking message could crash the code reading the socket.

That is like a mail sorter shutting down the whole mailroom because one envelope has a damaged label.

The fix makes the readers skip bad complete frames instead of throwing. If the JSON is invalid, the header length is impossible, or the payload lengths do not fit inside the frame, the frame is ignored.

This matters because local socket communication should be defensive. Even if the current sender is trusted, bugs, old versions, corrupted writes, or tests can produce malformed data.

Files involved:

`src/shim/protocol.ts`

`src/control/protocol.ts`

Tests involved:

`tests/shim/protocol.test.ts`

`tests/control/protocol.test.ts`

### 4. Server Startup Could Unlink An Active Socket

Openmux uses Unix socket files so clients can find local servers. The shim server and control server both listen through socket paths.

Before this fix, server startup removed the existing socket file before listening. That is safe only when the old socket file is stale. It is unsafe when another active server is already listening there.

That is like opening a new front desk and ripping the sign off the old front desk even though the old one is still serving people.

The risk is that a second openmux process could orphan the first server. Existing clients might still be connected, but new clients would no longer be able to find the original server correctly.

The fix checks whether the existing socket accepts connections before unlinking it. If it is active, startup fails with a clear error instead of stealing the path. If it is stale, startup removes it and continues.

Files involved:

`src/shim/server.ts`

`src/shim/server-socket.ts`

`src/control/server.ts`

Tests involved:

`tests/shim/server-socket.test.ts`

`tests/control/server-client.test.ts`

### 5. Bun Test Setup Was Missing Vitest-Style Timer APIs

Some tests were written using timer helpers commonly available in Vitest, such as advancing fake time or running all timers. Bun's `vi` compatibility object does not provide all of those helpers.

Before this fix, many timer-based unit tests failed because the helper function did not exist, not because the product code was broken.

That is like a stopwatch test failing because the test room has no stopwatch, not because the runner cannot run.

The fix adds a small compatibility layer in test setup. It provides fake timer behavior for the timer APIs used by this test suite.

This makes existing timer tests meaningful under Bun and reduces false failures.

Files involved:

`tests/setup.ts`

Example tests improved:

`tests/effect/resources.test.ts`

`tests/patterns/polling-overlap.test.ts`

`src/shim/server-requests.test.ts`

### 6. Circular Initialization Bugs Appeared In Tests

Some modules had values that were declared as `const` and then used during import cycles. In JavaScript and TypeScript, a `const` exists in a temporary unusable state before initialization finishes. If another module touches it too early, the runtime throws an error.

That is like two people trying to use each other's keys before either person has finished receiving their own key.

Two issues were fixed.

The shim server handler default PTY accessor was changed into a hoisted function, so import cycles can call it safely after module linking.

The PTY session factory avoided a top-level import that could be touched too early and moved it to a dynamic import inside the function path.

This reduces fragile import-order behavior and makes unit tests less dependent on lucky module load ordering.

Files involved:

`src/shim/server-handlers.ts`

`src/effect/services/pty/session-factory.ts`

Tests involved:

`tests/effect/services/pty/session-factory.test.ts`

Parts of `tests/effect/resources.integration.test.ts` also stopped failing for the shim handler circular initialization path, although that file is still blocked by missing native libraries in this environment.

### 7. Focused Stability Tests Were Added

The new tests are intentionally small and direct. This follows the style seen in tmux and zellij: when a stability bug is found, create a compact regression test that reproduces the failure class.

The tests cover the most important behaviors instead of testing everything through the full app.

They verify that a request does not hang if the socket closes.

They verify that a normal socket close allows reconnecting.

They verify that an explicit detached message remains terminal for the client.

They verify that malformed protocol frames are skipped without throwing.

They verify that active socket files are not removed during startup.

This improves stability because future refactors will break tests if they reintroduce these problems.

New test files:

`tests/shim/connection-lifecycle.test.ts`

`tests/shim/server-socket.test.ts`

Updated test files:

`tests/shim/protocol.test.ts`

`tests/control/protocol.test.ts`

`tests/control/server-client.test.ts`

`tests/setup.ts`

### 8. Validation Results

The focused stability tests pass.

TypeScript typechecking passes.

Linting passes.

The full TypeScript test suite improved but is not fully green in this local environment.

The remaining full-suite blockers are mostly environmental or suite-isolation issues.

`libzig_git` is missing because the native Zig git library has not been built.

`libzig_pty` is missing because the native Zig PTY library has not been built.

The machine also does not have `zig` installed, so `bun run test:git` cannot build the missing native library here.

The Ghostty emulator test passes alone, but fails in the full suite, which points to module mock ordering or module cache isolation rather than the tested behavior itself.

Commands that passed:

`bun run typecheck`

`bun run lint`

Focused test command covering the new stability work passed with `59 pass, 0 fail`.

Full command result:

`bun run test:ts` reached `1487 pass, 4 fail, 1 error`.

## Technical Explanation

### 1. Shim Request Lifecycle

The shim client keeps request promises in a process-level `pendingRequests` map keyed by `requestId`.

Before the fix, `sendRequest()` inserted a request into that map and wrote the encoded frame, but there was no timeout and no write callback error handling. If the socket closed before a matching response frame arrived, the request remained in the map forever and the returned promise never settled.

The fix adds centralized pending request lifecycle helpers.

`takePendingRequest(requestId)` removes a pending request and clears its timeout.

`rejectPendingRequests(error)` rejects every pending request and clears the map.

`clearSocketState(client)` clears socket reader state only for the current socket, avoiding stale close events from clearing a newer connection.

`sendRequest()` now takes an optional timeout, defaulting to `DEFAULT_REQUEST_TIMEOUT_MS`.

`sendRequestDirect()` now uses the same cleanup pattern for timeout and write callback errors.

`handleResponseFrame()` now removes requests through `takePendingRequest()` so timeouts are cleared on normal response.

The stability effect is that every request now has exactly one terminal path: response, protocol error response, timeout, write failure, socket close, or explicit detach.

Relevant file:

`src/shim/client/connection.ts`

Relevant test cases:

`rejects pending requests when the socket closes before response`

`reconnects after an ordinary socket close`

`keeps explicit detached events terminal for the client`

### 2. Detach Semantics Versus Transport Closure

The previous socket `close` handler called `markDetached()`. That conflated a transport-level close with a protocol-level detach.

Transport close means the TCP or Unix domain socket is no longer usable.

Protocol detach means the shim sent a frame with `type: 'detached'`, indicating the server revoked this client because another client took ownership.

The fix makes `close` do only transport cleanup and pending request rejection.

The only path that marks the client detached is still the frame handler path for `type: 'detached'` or the hello error path that explicitly reports detached state.

This preserves single-client semantics while allowing reconnection after accidental or ordinary socket closure.

Relevant file:

`src/shim/client/connection.ts`

### 3. Shim And Control FrameReader Hardening

Both shim and control protocols use this frame structure:

```text
[4 bytes total frame length][4 bytes header length][header JSON][payload bytes]
```

The prior implementation trusted the frame internals once enough bytes existed for the declared frame length.

The updated readers validate the inner header length before slicing the header JSON.

They catch `JSON.parse` failures.

They require the parsed header to be a non-null object.

They treat `payloadLengths` as valid only if it is an array.

They validate each payload length as a non-negative integer that fits inside the frame.

Bad complete frames are skipped and parsing continues with later frames in the same chunk.

This behavior intentionally does not throw. A protocol parser used in socket `data` handlers should avoid synchronous exceptions from malformed input.

Relevant files:

`src/shim/protocol.ts`

`src/control/protocol.ts`

Relevant tests:

`skips malformed JSON frames without throwing`

`skips frames with invalid header or payload lengths`

### 4. Active Unix Socket Protection

Unix domain socket paths can remain on disk after a process exits. Removing stale paths before `listen()` is common.

The unsafe case is when the path belongs to an active server. Calling `unlink()` on that path removes the filesystem entry while the old server continues running. The old server can become unreachable by path while still holding live connections.

The shim fix introduces `prepareShimSocketFile(socketPath)` in `src/shim/server-socket.ts`.

It tries to connect to the existing path.

If connect succeeds, the socket is active and startup returns `ShimConnectionError`.

If connect fails with `ENOENT` or `ECONNREFUSED`, the path is missing or stale and can be removed.

Other socket probe failures are returned as `ShimConnectionError`.

The control server applies the same logic internally in `src/control/server.ts` and now reads socket env vars at startup time. This matters for tests and runtime overrides because protocol constants can be initialized before the env var is changed.

Relevant files:

`src/shim/server.ts`

`src/shim/server-socket.ts`

`src/control/server.ts`

Relevant tests:

`tests/shim/server-socket.test.ts`

`tests/control/server-client.test.ts`

### 5. Bun Fake Timer Compatibility

The project uses `bun:test`, but parts of the suite call Vitest-style APIs on `vi`.

Examples include:

`vi.advanceTimersByTime()`

`vi.advanceTimersByTimeAsync()`

`vi.runAllTimers()`

`vi.runAllTimersAsync()`

`vi.runOnlyPendingTimers()`

`vi.getTimerCount()`

Bun's `vi` currently exposes only a smaller compatibility surface. The setup file already attempted to polyfill async variants by calling missing sync methods, which caused failures.

The updated `tests/setup.ts` installs a small fake timer scheduler.

When `vi.useFakeTimers()` is called, it replaces `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, and `Date.now` with controlled implementations.

The scheduler stores timers in a map with fake due times.

`advanceTimersByTime(ms)` advances the fake clock and runs due timers in order.

`runOnlyPendingTimers()` runs the currently pending timers once.

`runAllTimers()` drains timers with a guard to avoid infinite loops.

The async helpers await microtasks after advancing timers.

This is not meant to be a full fake-timer library. It is intentionally scoped to the APIs the current test suite already uses.

Relevant file:

`tests/setup.ts`

Relevant passing subsets:

`tests/effect/resources.test.ts`

`tests/patterns/polling-overlap.test.ts`

`src/shim/server-requests.test.ts`

### 6. Circular Initialization And TDZ Fixes

JavaScript modules have a temporal dead zone for `let` and `const` bindings. In cyclic imports, a module can observe another module's binding before it has finished initializing.

The shim handler issue involved `defaultWithPty` being a `const` function expression. A test path imported `createServerHandlers()` through a cycle and called it while `defaultWithPty` had not completed initialization.

Changing `defaultWithPty` to a hoisted function declaration removes that TDZ failure mode.

The PTY session factory issue first appeared with `DEFAULT_CELL_WIDTH` and `DEFAULT_CELL_HEIGHT`. Replacing those constants with hoisted functions removed that particular TDZ problem.

A later TDZ appeared around `ArchivedTerminalEmulator`. Moving that import to a dynamic import inside `createSession()` prevents the top-level binding from being touched before initialization in the affected test cycle.

Relevant files:

`src/shim/server-handlers.ts`

`src/effect/services/pty/session-factory.ts`

Relevant test:

`tests/effect/services/pty/session-factory.test.ts`

### 7. Regression Test Strategy Borrowed From tmux And zellij

tmux uses many focused shell regression tests. Each test often reproduces one behavior directly through a real tmux server.

zellij uses a large Rust unit and snapshot suite. It also has ignored e2e tests that run serially and capture terminal behavior through real parser paths.

The openmux changes follow the same philosophy at a smaller scale.

The connection lifecycle tests create a real local socket server and drive the actual shim client connection module. They do not mock the code being tested.

The protocol tests construct malformed frames directly and ensure the readers keep processing later valid frames.

The socket startup tests use real Unix socket files so active-versus-stale socket behavior is tested at the operating-system boundary.

This style catches stability regressions that pure object-level tests often miss.

### 8. Remaining Full-Suite Blockers

The full `bun run test:ts` result after fixes was:

```text
1487 pass
4 fail
1 error
```

The missing native libraries are environmental blockers in this workspace.

`libzig_git` is required by the Zig git TypeScript loader.

`libzig_pty` is required by the Zig PTY TypeScript loader.

The attempted native test command failed because `zig` is not installed:

```text
exec: zig: not found
```

The remaining Ghostty emulator failures are full-suite-only. The same test file passes by itself. That pattern usually means module mocking or module cache state differs depending on test order.

The next technical step is to isolate native-library-loading tests from pure TypeScript tests, or mock native loaders consistently before any module imports can resolve them. For the Ghostty case, the next step is to ensure the mock for `src/terminal/ghostty-vt/terminal` is installed before any earlier full-suite import can cache the real module.

## Current Validation Commands

These commands passed locally:

```sh
bun run typecheck
bun run lint
bun test tests/shim/protocol.test.ts tests/control/protocol.test.ts tests/shim/connection-lifecycle.test.ts tests/shim/server-socket.test.ts tests/control/server-client.test.ts tests/effect/resources.test.ts tests/patterns/polling-overlap.test.ts src/shim/server-requests.test.ts tests/effect/services/pty/session-factory.test.ts tests/terminal/ghostty-vt-emulator.test.ts
```

This command is still blocked in this environment:

```sh
bun run test:ts
```

Reason:

Missing native Zig libraries and one full-suite module mock ordering issue.

## Practical Stability Impact

The main stability improvement is that openmux now handles several failure modes explicitly instead of hoping they do not happen.

Lost shim socket responses no longer hang forever.

Transient socket closes no longer permanently detach the client.

Bad socket frames no longer throw synchronously from the parser.

Second server startup no longer silently steals an active socket path.

Timer-based tests now run under Bun instead of failing from missing compatibility helpers.

Two circular initialization failures are fixed, reducing order-dependent test and runtime fragility.

The remaining work is mostly test-environment hardening around native libraries and module mock isolation.
