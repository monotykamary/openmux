# openmux

A terminal multiplexer with master-stack layout (Zellij-style), built with:

- **Bun** - Fast JavaScript runtime
- **OpenTUI** - Terminal UI library with React reconciler
- **zig-pty** - PTY support for Bun (pure Zig implementation)
- **ghostty-web** - Terminal emulation via WASM

![openmux screenshot](assets/openmux-screenshot.png)

## Features

- Master-stack tiling layout (like Zellij)
- i3-gaps style gaps and borders
- Vim-style `hjkl` navigation
- Tmux-style `Ctrl+b` prefix key
- 9 workspaces with isolated pane layouts
- Session persistence and management
- Pane zoom (fullscreen focused pane)
- Kitty Graphics and Sixel protocol support
- Mouse tracking (click to focus, tabbed pane switching)
- Scrollback support with mouse wheel and scrollbar

## Installation

### Quick Install (curl)

```bash
curl -fsSL https://raw.githubusercontent.com/monotykamary/openmux/main/scripts/install.sh | bash
```

### npm / bun

```bash
npm install -g openmux
# or
bun add -g openmux
```

### From Source

```bash
git clone https://github.com/monotykamary/openmux.git
cd openmux
bun install
bun run build --install
```

### GitHub Releases

Download prebuilt binaries from [GitHub Releases](https://github.com/monotykamary/openmux/releases).

Available platforms:
- macOS (Apple Silicon)
- Linux (x64 / arm64)

## Usage

```bash
openmux
```

For development:

```bash
bun start      # Run from source
bun dev        # Run with watch mode
```

## Keyboard Shortcuts

### Normal Mode (Alt shortcuts - no prefix needed)
- `Alt+h/j/k/l` - Navigate panes
- `Alt+n` - New pane
- `Alt+1-9` - Switch to workspace 1-9
- `Alt+[` / `Alt+]` - Cycle layout mode (vertical → horizontal → stacked)
- `Alt+x` - Close pane
- `Alt+z` - Toggle zoom (fullscreen focused pane)
- `Alt+s` - Open session picker
- `Ctrl+b` - Enter prefix mode

### Mouse
- `Click` - Focus pane
- `Click tab` - Switch to stacked pane (in stacked mode)
- `Scroll wheel` - Scroll through terminal history (when not in alternate screen apps like vim)
- `Click scrollbar` - Jump to position in scrollback
- `Drag scrollbar` - Scroll through history by dragging

### Prefix Mode (Ctrl+b, 2s timeout)
- `n` or `Enter` - New pane
- `h/j/k/l` - Navigate panes
- `1-9` - Switch to workspace 1-9
- `v` - Set layout mode: vertical
- `H` - Set layout mode: horizontal
- `t` - Set layout mode: stacked (tabbed)
- `x` - Close current pane
- `z` - Toggle zoom
- `s` - Open session picker
- `]` - Paste from clipboard
- `r` - Enter resize mode
- `?` - Toggle keyboard hints
- `Esc` - Exit prefix mode

### Resize Mode
- `h/l` - Shrink/grow width
- `j/k` - Grow/shrink height
- `Enter/Esc` - Exit resize mode

## Concepts

### Workspaces
Like i3/sway, openmux supports multiple workspaces (1-9). Each workspace has its own layout tree of panes. The status bar shows populated workspaces dynamically - empty workspaces don't appear unless active.

### Layout Modes (Zellij-style)
Each workspace has a layout mode that determines how panes are arranged:
- **Vertical** (`│`): Main pane on left, stack panes split vertically on right
- **Horizontal** (`─`): Main pane on top, stack panes split horizontally on bottom
- **Stacked** (`▣`): Main pane on left, stack panes tabbed on right (only active visible)

### Sessions
Sessions persist your workspace layouts and pane working directories. Sessions are auto-saved to `~/.config/openmux/sessions/` and can be switched via the session picker (`Alt+s` or `Ctrl+b s`).

## Project Structure

```
src/
├── core/                           # Core layout and session management
│   ├── types.ts                    # Type definitions (Workspace, Pane, etc.)
│   ├── config.ts                   # Configuration and defaults
│   ├── keyboard-utils.ts           # hjkl to Direction conversion
│   ├── operations/
│   │   ├── index.ts                # Layout operations exports
│   │   └── master-stack-layout.ts  # Master-stack layout calculations
│   └── session/                    # Session persistence
│       ├── index.ts                # Session exports
│       ├── session-manager.ts      # High-level session operations
│       ├── session-serializer.ts   # Serialize/deserialize sessions
│       └── session-storage.ts      # Disk I/O for sessions
│
├── components/                     # OpenTUI React components
│   ├── index.ts                    # Component exports
│   ├── Pane.tsx                    # Individual pane with border/focus
│   ├── PaneContainer.tsx           # Layout pane renderer
│   ├── TerminalView.tsx            # Terminal rendering with buffer API
│   ├── StatusBar.tsx               # Bottom status bar
│   ├── KeyboardHints.tsx           # Keyboard shortcuts overlay
│   └── SessionPicker.tsx           # Session selection modal
│
├── contexts/                       # React contexts for state
│   ├── index.ts                    # Context exports
│   ├── LayoutContext.tsx           # Workspace/pane layout state reducer
│   ├── TerminalContext.tsx         # PTY management and lifecycle
│   ├── KeyboardContext.tsx         # Prefix mode and key state
│   ├── SessionContext.tsx          # Session management and persistence
│   └── ThemeContext.tsx            # Theme/styling configuration
│
├── terminal/                       # PTY and terminal emulation
│   ├── index.ts                    # Terminal exports
│   ├── pty-manager.ts              # PTY session lifecycle (zig-pty)
│   ├── ghostty-emulator.ts         # Terminal emulator (ghostty-web WASM)
│   ├── input-handler.ts            # Key/mouse to escape sequence encoder
│   ├── graphics-passthrough.ts     # Kitty Graphics/Sixel protocol
│   ├── capabilities.ts             # Terminal capability detection
│   └── terminal-colors.ts          # Color palette detection
│
├── utils/
│   ├── index.ts                    # Utils exports
│   └── clipboard.ts                # Clipboard read/write
│
├── App.tsx                         # Main app component with context hierarchy
└── index.tsx                       # Entry point (Bun serve + OpenTUI renderer)
```

## Development Status

Current status:

- [x] Master-stack layout with gaps
- [x] OpenTUI component layer
- [x] Keyboard navigation system
- [x] PTY integration
- [x] ghostty-web WASM terminal emulation
- [x] Workspaces (1-9)
- [x] Layout modes (vertical/horizontal/stacked)
- [x] Session persistence
- [x] Pane zoom
- [x] Mouse support
- [x] Graphics protocol passthrough (Kitty/Sixel)
- [x] Scrollback support
- [ ] Session restore on startup
- [ ] Configurable keybindings

## License

MIT
