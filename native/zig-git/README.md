# zig-git

Minimal libgit2 bindings for Bun - focused on repository status and diff stats.

## Features

- **Minimal** - Only exposes what's needed for git status in terminal UIs
- **Async** - Non-blocking status/diff operations with background threads
- **Efficient** - Reuses libgit2 library state across calls
- **Type-safe** - Full TypeScript bindings with proper type definitions
- **Cancelable** - Async operations can be canceled to avoid blocking on slow repos

## Installation

```bash
# Build the Zig library (builds libgit2 as a dependency)
zig build -Doptimize=ReleaseFast

# Build the TypeScript wrapper
bun build ./src/index.ts --outdir ./dist --target bun
```

## Usage

```typescript
import {
  getRepoInfo,
  getRepoStatus,
  getRepoStatusAsync,
  getDiffStatsAsync,
} from "zig-git";

// Quick repo info (branch, dirty status, paths)
const info = getRepoInfo("/path/to/repo");
console.log(info);
// { branch: "main", dirty: true, gitDir: "/path/to/.git", workDir: "/path/to" }

// Detailed status (file counts, ahead/behind, repo state)
const status = getRepoStatus("/path/to/repo");
console.log(status);
// {
//   branch: "main",
//   dirty: true,
//   gitDir: "/path/to/.git",
//   workDir: "/path/to",
//   staged: 2,
//   unstaged: 5,
//   untracked: 3,
//   conflicted: 0,
//   ahead: 1,
//   behind: 0,
//   stashCount: 2,
//   state: "none",
//   detached: false
// }

// Async status (non-blocking, good for large repos)
const statusAsync = await getRepoStatusAsync("/path/to/repo");
 console.log(statusAsync);
// Same structure as getRepoStatus

// Async diff stats (added/removed line counts + binary file count)
const diffStats = await getDiffStatsAsync("/path/to/repo");
console.log(diffStats);
// { added: 15, removed: 3, binary: 1 }
```

## API

### `getRepoInfo(cwd: string)`

Gets minimal repository information synchronously. Fast for displaying in UI status bars.

**Returns** `NativeGitInfo | null`:
- `branch: string | null` - Current branch name
- `dirty: boolean` - Working directory has uncommitted changes
- `gitDir: string | null` - Path to `.git` directory
- `workDir: string | null` - Working tree path

### `getRepoStatus(cwd: string)`

Gets detailed repository status synchronously.

**Returns** `GitRepoStatus | null` (extends `NativeGitInfo` with):
- `staged: number` - Number of staged files
- `unstaged: number` - Number of unstaged changes
- `untracked: number` - Number of untracked files
- `conflicted: number` - Number of conflicted files
- `ahead: number | null` - Commits ahead of upstream
- `behind: number | null` - Commits behind upstream
- `stashCount: number | null` - Number of stashes
- `state: GitRepoState` - Repository state (merge/rebase/etc.)
- `detached: boolean` - HEAD is detached

**GitRepoState values:**
- `"none"` - Normal state
- `"merge"` - Merge in progress
- `"revert"` / `"revert-seq"` - Revert in progress
- `"cherry-pick"` / `"cherry-pick-seq"` - Cherry-pick in progress
- `"bisect"` - Bisect in progress
- `"rebase"` / `"rebase-interactive"` / `"rebase-merge"` - Rebase in progress
- `"apply-mailbox"` / `"apply-mailbox-or-rebase"` - Apply mailbox in progress
- `"unknown"` - Unrecognized state

### `getRepoStatusAsync(cwd: string, options?)`

Gets repository status asynchronously using a background thread. Non-blocking for the main thread.

**Options:**
- `pollIntervalMs?: number` - Poll interval in ms (default: 10)

**Returns** `Promise<GitRepoStatus | null>`

### `getDiffStatsAsync(cwd: string, options?)`

Gets diff statistics (added/removed lines) asynchronously (includes binary file count).

**Options:**
- `pollIntervalMs?: number` - Poll interval in ms (default: 10)

**Returns** `Promise<GitDiffStats | null>`:
- `added: number` - Number of lines added
- `removed: number` - Number of lines removed
- `binary: number` - Number of binary files changed

### `cancelRepoStatus(requestId: number)`

Cancels an in-progress async status request.

### `cancelDiffStats(requestId: number)`

Cancels an in-progress async diff stats request.

## Constants

- `DIFF_PENDING = -3` - Async diff operation still in progress
- `STATUS_PENDING = -5` - Async status operation still in progress

## Async Request Pattern

The async API uses a request/poll pattern:

```typescript
import { getDiffStatsAsync, DIFF_PENDING } from "zig-git";

const requestId = getDiffStatsAsync("/path/to/repo");

// Poll until complete
while (true) {
  const result = pollDiffStats(requestId);
  if (result === DIFF_PENDING) {
    await sleep(10);
    continue;
  }
  break;
}
```

The TypeScript wrapper (`getDiffStatsAsync`) handles the polling internally with promises.

## Building

Requires Zig 0.11+, Bun 1.0+, and CMake (for libgit2).

```bash
# Development build
zig build

# Release build
zig build -Doptimize=ReleaseFast

# Run tests (Zig)
zig build test

# Run TypeScript tests
bun test ts/*.test.ts
```

## Cross-compilation

Zig makes cross-compilation trivial:

```bash
# Linux x86_64
zig build -Doptimize=ReleaseFast -Dtarget=x86_64-linux

# Linux ARM64
zig build -Doptimize=ReleaseFast -Dtarget=aarch64-linux

# Windows x86_64
zig build -Doptimize=ReleaseFast -Dtarget=x86_64-windows
```

Note: Cross-compiling requires appropriate CMake toolchains for the target platform.

## Architecture

The library uses a background thread pool for async operations:
- Status operations are queued to a dedicated thread
- Diff operations run in parallel on a separate thread
- Atomic operations ensure thread-safe state management
- Requests can be canceled mid-flight

This keeps the main Bun event loop unblocked even for large repositories.

## License

MIT
