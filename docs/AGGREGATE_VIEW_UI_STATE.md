# Aggregate View UI State Restore

## Goal
Optionally restore the AggregateView overlay state after detach/reattach so users
return to the same view (list/preview, selection, filter).

## Scope
This is limited to client-side UI state. It does not modify PTY behavior or
session data unless we opt into persistence.

## State Shape (Minimal)
```
{
  showAggregateView: boolean,
  filterQuery: string,
  selectedPtyId: string | null,
  previewMode: boolean
}
```

## Approach A: Ephemeral (Shim Memory)
- Store the UI state in the shim process memory.
- Write on detach or client exit.
- Read on attach (hello response) and reapply in the client.

### Pros
- Simple and fast.
- No session file changes.

### Cons
- Lost if shim restarts or crashes.

### Sketch
1) Client sends `setUiState { aggregate: ... }` before detach.
2) Shim stores per-session or per-client.
3) On hello, shim includes `uiState` in response.
4) Client restores after PTY list is loaded.

## Approach B: Persistent (Session JSON)
- Persist the UI state in session JSON alongside layout/session info.
- Restore on session load (even after shim restart).

### Pros
- Survives shim restart.
- Predictable for long-running sessions.

### Cons
- Needs versioning and cleanup for stale PTY IDs.
- Slightly more invasive to session schema.

### Sketch
1) Session save includes `uiState.aggregate` if present.
2) On session restore, the UI pulls it and attempts to restore.
3) If `selectedPtyId` no longer exists, fall back to list mode.

## Restore Ordering
- Always wait until PTY list is refreshed before selecting a PTY.
- If `selectedPtyId` is missing, set `previewMode=false` and default to index 0.

## Recommendation
Start with Approach A (ephemeral) to avoid schema changes. If this becomes a
user expectation across restarts, add Approach B with defensive fallbacks.
