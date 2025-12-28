# AGENTS.md

This file provides guidance to coding agents working with the openmux repository.

## Build and Run Commands

```bash
bun install           # Install dependencies
bun start             # Build and run the terminal multiplexer
bun dev               # Run with watch mode (--watch)
bun run typecheck     # Type check without emitting
bun run lint          # Lint Effect code (effect-language-service)
bun run build         # Build standalone binary (./scripts/build.sh)
bun run build:release # Build optimized binary
bun run install:local # Build and install locally
bun run test          # Run TS + Zig + Ghostty VT tests
bun run test:ts       # Run Vitest only
bun run test:pty      # Run Zig PTY tests only
bun run test:ghostty-vt # Run Ghostty VT Zig tests
bun run test:watch    # Run Vitest in watch mode
bun run check:circular # Detect circular deps in src/
```

## libghostty-vt Notes

- Ghostty is tracked as a submodule in `vendor/ghostty`.
- Update + apply the terminal C API patch with `scripts/update-ghostty-vt.sh`.
- `scripts/build.sh` builds `libghostty-vt` via `zig build lib-vt` before bundling.

## Technology Stack

- **Bun** - Runtime and package manager (use instead of Node.js)
- **OpenTUI** - Terminal UI library with SolidJS reconciler (@opentui/core, @opentui/solid)
- **SolidJS** - Reactive UI framework via OpenTUI's SolidJS reconciler
- **zig-pty** - PTY support for shell process management (pure Zig implementation)
- **libghostty-vt** - Native terminal emulator (VT parsing/state)
- **Effect** - Typed functional programming for services (gradual migration in src/effect/)

## Architecture Overview

openmux is a terminal multiplexer with a master-stack tiling layout (Zellij-style). The UI is SolidJS components rendered to the terminal via OpenTUI, with PTYs managed in Zig and emulated via native libghostty-vt.

### Entry Points

- `src/index.tsx` - CLI entry, renderer setup
- `src/shim/main.ts` - Shim server entry (background detach/attach)
- `src/App.tsx` - Provider tree and top-level app wiring

### Core Data Flow

```
Keyboard Input → KeyboardContext → Layout/Terminal actions
                                ↓
                    Master-stack layout calculation
                                ↓
                       PaneContainer/TerminalView
PTY Data → zig-pty → GhosttyVTEmulator (libghostty-vt) → Shim protocol → TerminalContext
                                ↓
                   TerminalView + AggregateView preview
Session data → SessionContext → disk persistence → SessionBridge (Layout/Terminal)
Title updates → TitleContext → StatusBar/window title
```

Note: In shim server mode, PTY data stays local; in shim client mode, it flows through the shim protocol.

Detach/attach uses a single-client lock; new clients steal the lock and detach the previous client.

### Context Hierarchy (src/App.tsx)

```tsx
ThemeProvider              // Styling/theming
  └── LayoutProvider       // Workspace/pane state (reducer pattern)
        └── KeyboardProvider    // Prefix mode, key state
              └── TitleProvider     // Terminal title updates
                    └── TerminalProvider   // PTY lifecycle, terminal state
                          └── SelectionProvider  // Text selection state
                                └── SearchProvider    // Terminal search
                                      └── SessionBridge   // SessionProvider wiring
                                            └── AggregateViewProvider  // Cross-workspace overlay
                                                  └── AppContent
```

### Key Modules

**Layout and session state (src/core/)**
- `types.ts`, `config.ts` - Core types and defaults
- `operations/master-stack-layout.ts` - Layout calculation
- `operations/layout-actions/` - Pane/workspace actions
- `operations/session-actions/` - Session restore/save helpers
- `workspace-utils.ts`, `coordinates/`, `scroll-utils.ts`, `keyboard-utils.ts`

**Terminal layer (src/terminal/)**
- `ghostty-vt/`, `emulator-utils/` - native libghostty-vt bindings + shared emulator helpers
- `emulator-interface.ts` - ITerminalEmulator abstraction
- `input-handler.ts`, `sync-mode-parser.ts` - Input/escape handling
- `title-parser.ts`, `terminal-query-passthrough/` - Title/query parsing
- `graphics-passthrough.ts`, `paste-intercepting-stdin.ts`, `focused-pty-registry.ts`

**Shim / detach (src/shim/)**
- `main.ts`, `server.ts` - Shim server + RPC handling
- `client/` - Shim client connection, PTY state cache, detach handling

**UI components (src/components/)**
- `PaneContainer.tsx`, `Pane.tsx`, `TerminalView.tsx` - Pane rendering
- `AggregateView.tsx`, `SessionPicker.tsx`, `SearchOverlay.tsx`
- `StatusBar.tsx`, `CopyNotification.tsx`

**SolidJS contexts (src/contexts/)**
- `LayoutContext.tsx`, `TerminalContext.tsx`, `KeyboardContext.tsx`
- `SelectionContext.tsx`, `SearchContext.tsx`, `SessionContext.tsx`
- `ThemeContext.tsx`, `TitleContext.tsx`, `AggregateViewContext.tsx`

**Effect module (src/effect/)**
- `services/`, `models.ts`, `types.ts` - Effect services and schemas
- `bridge/`, `bridge.ts` - SolidJS/Effect interoperability
- `runtime.ts`, `Config.ts`, `errors.ts`

### SolidJS Reactivity Patterns

Contexts expose values via object properties. Understanding what's safe to destructure is critical:

**Safe to destructure (action functions):**
```tsx
const { newPane, closePane, focusPane } = useLayout();  // Plain functions
const { createPTY, writeToPTY } = useTerminal();        // Plain functions
```

**Safe to destructure (store proxy - accessing properties IS reactive):**
```tsx
const { state } = useLayout();
state.workspaces;           // Reactive - store proxy tracks access
state.activeWorkspaceId;    // Reactive
```

**NOT safe to destructure (computed getters - call signal/memo inside):**
```tsx
// DON'T: Destructuring calls the getter once, loses reactivity
const { activeWorkspace, panes, isInitialized } = useLayout();

// DO: Access via context object to call getter at access time
const layout = useLayout();
layout.activeWorkspace;     // Calls getter each time, stays reactive
layout.panes;               // Calls getter each time, stays reactive
```

**Computed getters by context (access via context object, don't destructure):**
- `LayoutContext`: `activeWorkspace`, `panes`, `paneCount`, `populatedWorkspaces`, `layoutVersion`
- `TerminalContext`: `isInitialized`
- `SessionContext`: `filteredSessions`
- `SelectionContext`: `selectionVersion`, `copyNotification`
- `SearchContext`: `searchState`, `searchVersion`

### Layout Modes

Each workspace has a `layoutMode` that determines pane arrangement:
- **vertical**: Main pane left, stack panes split vertically on right
- **horizontal**: Main pane top, stack panes split horizontally on bottom
- **stacked**: Main pane left, stack panes tabbed on right (only active visible)

### Workspaces and Sessions

- Workspaces are indexed 1-9 and maintain separate layout state.
- Sessions persist to `~/.config/openmux/sessions/` and are coordinated by `SessionContext` and `SessionBridge`.
- Session restores reuse existing PTYs when possible, otherwise new PTYs are created from stored CWDs.

<!-- effect-solutions:start -->
## Effect Solutions Usage

The Effect Solutions CLI provides curated best practices and patterns for Effect TypeScript. Before working on Effect code, check if there's a relevant topic that covers your use case.

- `effect-solutions list` - List all available topics
- `effect-solutions show <slug...>` - Read one or more topics
- `effect-solutions search <term>` - Search topics by keyword

**Local Effect Source:** The Effect repository is cloned to `~/.local/share/effect-solutions/effect` for reference. Use this to explore APIs, find usage examples, and understand implementation details when the documentation isn't enough.
<!-- effect-solutions:end -->
