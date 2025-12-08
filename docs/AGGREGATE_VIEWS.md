# Aggregate Views Architecture

> Virtual workspaces that aggregate terminals across sessions, similar to [tmuxwatch](https://github.com/steipete/tmuxwatch).

## Problem Statement

Currently, openmux organizes terminals hierarchically:

```
Session → Workspaces (1-9) → Panes (main + stack)
```

Users can only view terminals within the **active session and workspace**. There's no way to:

- See all instances of a specific command across sessions
- Monitor multiple long-running processes in one view
- Create ad-hoc groupings independent of session structure

## Solution: Aggregate View Layer

A **virtual workspace** that queries terminals across all sessions based on filters:

```
┌──────────────────────────────────────────────────────────────┐
│                 Virtual Workspace: "Claude Code"             │
│  Filter: command contains "claude" OR title contains "claude"│
├──────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌───────────────────────────────────────┐ │
│  │ Matched PTYs │  │                                       │ │
│  │              │  │   Selected Terminal Output            │ │
│  │ ● session-a  │  │                                       │ │
│  │   ws1:pty3   │  │   $ claude "help me fix this bug"     │ │
│  │              │  │                                       │ │
│  │ ○ session-b  │  │   I'll help you fix the bug. Let me   │ │
│  │   ws2:pty1   │  │   first examine the code...           │ │
│  │              │  │                                       │ │
│  │ ○ session-b  │  │                                       │ │
│  │   ws4:pty2   │  │                                       │ │
│  │              │  │                                       │ │
│  │ ○ session-c  │  │                                       │ │
│  │   ws1:pty1   │  │                                       │ │
│  └──────────────┘  └───────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## Use Cases

### 1. Monitor All Claude Instances

```typescript
const filter = {
  type: 'or',
  conditions: [
    { field: 'command', contains: 'claude' },
    { field: 'title', contains: 'claude' },
  ]
}
```

### 2. Watch All Build Processes

```typescript
const filter = {
  type: 'or',
  conditions: [
    { field: 'command', matches: /npm run (build|dev|start)/ },
    { field: 'command', contains: 'cargo build' },
    { field: 'command', contains: 'make' },
  ]
}
```

### 3. Session Overview

```typescript
// All terminals in a specific session (cross-workspace)
const filter = {
  type: 'equals',
  field: 'sessionId',
  value: 'session-abc'
}
```

### 4. Recent Activity

```typescript
// Terminals with output in last 5 minutes
const filter = {
  type: 'recentActivity',
  within: { minutes: 5 }
}
```

## Architecture

### Data Flow

```
┌───────────────────────────────────────────────────────────┐
│                      Aggregate View                       │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              AggregateQuery Service                 │  │
│  │                                                     │  │
│  │  filter: FilterExpression                           │  │
│  │  results: Stream<AggregatedPty[]>                   │  │
│  └─────────────────────────────────────────────────────┘  │
│                           │                               │
│              ┌────────────┴────────────┐                  │
│              ▼                         ▼                  │
│  ┌─────────────────────┐   ┌─────────────────────┐        │
│  │   ShimClient        │   │   ShimClient        │        │
│  │   (session-a)       │   │   (session-b)       │        │
│  └─────────────────────┘   └─────────────────────┘        │
│              │                         │                  │
│              ▼                         ▼                  │
│  ┌─────────────────────┐   ┌─────────────────────┐        │
│  │   Shim Process      │   │   Shim Process      │        │
│  │   PTYs + Emulators  │   │   PTYs + Emulators  │        │
│  └─────────────────────┘   └─────────────────────┘        │
└───────────────────────────────────────────────────────────┘
```

### Stream Composition

The aggregate view is fundamentally **stream composition**—merging PTY outputs from multiple sources:

```typescript
import { Effect, Stream } from "effect"

const aggregatedStream = Effect.gen(function* () {
  const shim = yield* ShimClient
  const sessions = yield* shim.listConnectedSessions()

  // Query all PTYs across all sessions (parallel)
  const allPtys = yield* Effect.forEach(
    sessions,
    (s) => shim.getPtys(s.id).pipe(
      Effect.map(ptys => ptys.map(p => ({ sessionId: s.id, ...p })))
    ),
    { concurrency: 'unbounded' }
  ).pipe(Effect.map(arrays => arrays.flat()))

  // Apply filter
  const matchingPtys = allPtys.filter(pty => matchesFilter(pty, filter))

  // Merge output streams from all matching PTYs
  return Stream.mergeAll(
    matchingPtys.map(p =>
      shim.subscribeOutput(p.sessionId, p.ptyId).pipe(
        Stream.map(output => ({ ...p, output }))
      )
    ),
    { concurrency: 'unbounded' }
  )
})
```

## Why Effect?

This is where Effect's primitives genuinely reduce complexity:

### Stream Merging

```typescript
// Effect: declarative
Stream.mergeAll(streams, { concurrency: 'unbounded' })

// Vanilla: manual event aggregation
const merged = new EventEmitter()
streams.forEach(s => s.on('data', d => merged.emit('data', d)))
// + cleanup tracking, error handling, backpressure...
```

### Dynamic Subscriptions

When a new PTY spawns that matches the filter, it should appear automatically:

```typescript
const dynamicAggregation = Stream.flatMap(
  ptyLifecycleStream,
  (event) => {
    if (event._tag === 'created' && matchesFilter(event.pty, filter)) {
      return shim.subscribeOutput(event.sessionId, event.ptyId)
    }
    return Stream.empty
  }
)
```

### Parallel Queries with Concurrency Control

```typescript
// Query all sessions, max 5 concurrent connections
yield* Effect.forEach(
  sessions,
  (s) => shim.connect(s.id),
  { concurrency: 5 }
)
```

### Resource Cleanup

```typescript
// Scoped cleanup: when view closes, all subscriptions cleaned up
const view = Effect.scoped(
  Effect.gen(function* () {
    const subscriptions = yield* setupAggregateSubscriptions()
    yield* Effect.addFinalizer(() => cleanupAll(subscriptions))
    return yield* renderView()
  })
)
```

## Filter Schema

```typescript
import { Schema } from "effect"

const FilterCondition = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("contains"),
    field: Schema.Literal("command", "title", "cwd"),
    value: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal("matches"),
    field: Schema.Literal("command", "title", "cwd"),
    pattern: Schema.String, // regex
  }),
  Schema.Struct({
    _tag: Schema.Literal("equals"),
    field: Schema.Literal("sessionId", "workspaceId", "ptyId"),
    value: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal("recentActivity"),
    withinSeconds: Schema.Int,
  }),
)

const FilterExpression: Schema.Schema<FilterExpression> = Schema.suspend(() =>
  Schema.Union(
    FilterCondition,
    Schema.Struct({
      _tag: Schema.Literal("and"),
      conditions: Schema.Array(FilterExpression),
    }),
    Schema.Struct({
      _tag: Schema.Literal("or"),
      conditions: Schema.Array(FilterExpression),
    }),
    Schema.Struct({
      _tag: Schema.Literal("not"),
      condition: FilterExpression,
    }),
  )
)
```

## Effect Service

```typescript
class AggregateQuery extends Context.Tag("@openmux/AggregateQuery")<
  AggregateQuery,
  {
    // Execute a one-time query
    query: (filter: FilterExpression) => Effect<AggregatedPty[]>

    // Subscribe to matching PTYs (dynamic updates)
    subscribe: (filter: FilterExpression) => Stream<AggregateEvent>

    // Get merged output stream for matching PTYs
    mergedOutput: (filter: FilterExpression) => Stream<PtyOutput>
  }
>() {}

type AggregateEvent =
  | { _tag: 'added'; pty: AggregatedPty }
  | { _tag: 'removed'; ptyId: PtyId }
  | { _tag: 'updated'; pty: AggregatedPty }

type AggregatedPty = {
  sessionId: SessionId
  sessionName: string
  workspaceId: WorkspaceId
  ptyId: PtyId
  command?: string
  title?: string
  cwd: string
  lastActivity: number
}
```

## React Integration

```typescript
// Custom hook for aggregate views
function useAggregateView(filter: FilterExpression) {
  const [ptys, setPtys] = useState<AggregatedPty[]>([])
  const [selectedPty, setSelectedPty] = useState<PtyId | null>(null)

  useEffect(() => {
    const subscription = runStream(
      AggregateQuery.subscribe(filter),
      (event) => {
        if (event._tag === 'added') {
          setPtys(prev => [...prev, event.pty])
        } else if (event._tag === 'removed') {
          setPtys(prev => prev.filter(p => p.ptyId !== event.ptyId))
        }
      }
    )
    return () => subscription.unsubscribe()
  }, [filter])

  return { ptys, selectedPty, setSelectedPty }
}
```

## Relationship to Background Sessions

Aggregate views **depend on** the background sessions architecture:

1. **Multiple sessions must be alive** to aggregate across them
2. **Shim protocol** provides the PTY lifecycle events (`created`, `exit`)
3. **Socket connections** allow subscribing to output from any session

The shim protocol should be designed with aggregation in mind—emitting events that the `AggregateQuery` service can consume.

## Future Extensions

### Saved Views

```typescript
// Persist filter configurations
const savedViews = [
  { name: "Claude Instances", filter: { ... } },
  { name: "Build Processes", filter: { ... } },
]
```

### Cross-Machine Aggregation

```typescript
// Connect to remote openmux instances
const remoteShim = yield* ShimClient.connectRemote("ssh://server/socket")
```

### View Layouts

```typescript
// Grid view: show multiple terminals simultaneously
// Timeline view: show output chronologically across PTYs
// Split view: compare two filtered sets side-by-side
```
