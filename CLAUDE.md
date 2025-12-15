# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Run Commands

```bash
bun install           # Install dependencies
bun start             # Run the terminal multiplexer
bun dev               # Run with watch mode (--watch)
bun run typecheck     # Type check without emitting
bun run build         # Build standalone binary (./scripts/build.sh)
bun run install:local # Build and install locally
bun run test          # Run tests (vitest)
bun run test:watch    # Run tests in watch mode
```

## Technology Stack

- **Bun** - Runtime and package manager (use instead of Node.js)
- **OpenTUI** - Terminal UI library with React reconciler (@opentui/core, @opentui/react)
- **zig-pty** - PTY support for shell process management (pure Zig implementation)
- **ghostty-web** - WASM-based terminal emulator (VT parsing)
- **React 19** - UI components via OpenTUI's React reconciler
- **Effect** - Typed functional programming for services (gradual migration in src/effect/)

## Architecture Overview

openmux is a terminal multiplexer with a master-stack tiling layout (Zellij-style). The architecture follows a React-based component model rendered to the terminal via OpenTUI.

### Core Data Flow

```
Keyboard Input → KeyboardContext → LayoutContext (dispatch actions)
                                          ↓
                              Master-stack layout calculation
                                          ↓
PTY Data → PTYManager → GhosttyEmulator → TerminalContext → TerminalView components
```

### Context Hierarchy (src/App.tsx)

```tsx
ThemeProvider              // Styling/theming
  └── LayoutProvider       // Workspace/pane state (reducer pattern)
        └── KeyboardProvider    // Prefix mode, key state
              └── TerminalProvider   // PTY lifecycle, terminal state
                    └── SelectionProvider  // Text selection state
                          └── SearchProvider    // Terminal search
                                └── SessionProvider  // Session persistence
```

### Key Modules

**Layout System (src/core/)**
- `types.ts` - Core types: Workspace, PaneData, LayoutMode, Rectangle
- `operations/master-stack-layout.ts` - Calculates pane positions based on layout mode (vertical/horizontal/stacked)
- `session/` - Session serialization and persistence to `~/.config/openmux/sessions/`

**Terminal Layer (src/terminal/)**
- `pty-manager.ts` - Singleton managing PTY sessions via zig-pty, coordinates with ghostty emulator
- `ghostty-emulator.ts` - WASM terminal emulator wrapper, handles VT parsing and scrollback
- `input-handler.ts` - Converts keyboard events to escape sequences (handles DECCKM mode)
- `graphics-passthrough.ts` - Kitty Graphics and Sixel protocol passthrough to host terminal

**React Contexts (src/contexts/)**
- `LayoutContext.tsx` - Reducer-based workspace/pane management, handles NAVIGATE, NEW_PANE, CLOSE_PANE, etc.
- `TerminalContext.tsx` - Manages PTY creation/destruction, subscribes to terminal state updates
- `KeyboardContext.tsx` - Handles prefix mode (Ctrl+b) with 2s timeout, resize mode
- `SelectionContext.tsx` - Text selection state and clipboard operations
- `SearchContext.tsx` - Terminal search functionality with match navigation

**Effect Module (src/effect/)** - Gradual migration to Effect-TS
- `services/` - Effect services (Clipboard, FileSystem, Pty, SessionManager, SessionStorage)
- `models.ts` - Domain models with Schema validation (Rectangle, PaneData, SerializedSession)
- `runtime.ts` - App and test layer composition with ManagedRuntime
- `bridge.ts` - Integration bridge for gradual adoption alongside React contexts

### Layout Modes

Each workspace has a `layoutMode` that determines pane arrangement:
- **vertical**: Main pane left, stack panes split vertically on right
- **horizontal**: Main pane top, stack panes split horizontally on bottom
- **stacked**: Main pane left, stack panes tabbed on right (only active visible)

### Workspaces

9 workspaces (1-9) with isolated layouts. Each workspace has:
- `mainPane` - Primary pane (promoted from stack when closed)
- `stackPanes[]` - Secondary panes
- `activeStackIndex` - For stacked mode tab selection
- `zoomed` - Fullscreen focused pane toggle

<!-- effect-solutions:start -->
## Effect Solutions Usage

The Effect Solutions CLI provides curated best practices and patterns for Effect TypeScript. Before working on Effect code, check if there's a relevant topic that covers your use case.

- `effect-solutions list` - List all available topics
- `effect-solutions show <slug...>` - Read one or more topics
- `effect-solutions search <term>` - Search topics by keyword

**Local Effect Source:** The Effect repository is cloned to `~/.local/share/effect-solutions/effect` for reference. Use this to explore APIs, find usage examples, and understand implementation details when the documentation isn't enough.
<!-- effect-solutions:end -->
