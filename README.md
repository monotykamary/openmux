# openmux

[![GitHub Release](https://img.shields.io/github/v/release/monotykamary/openmux)](https://github.com/monotykamary/openmux/releases)
[![codecov](https://codecov.io/gh/monotykamary/openmux/graph/badge.svg)](https://codecov.io/gh/monotykamary/openmux)

A terminal multiplexer with master-stack layout (Zellij-style), built with:

- **Bun** - Fast JavaScript runtime
- **OpenTUI** - Terminal UI library with SolidJS reconciler
- **SolidJS** - Reactive UI framework
- **zig-pty** - PTY support for Bun (pure Zig implementation)
- **libghostty-vt** - Native terminal emulation (VT parser/state)

![openmux screenshot](assets/openmux-screenshot.png)

## Features

- Master-stack tiling layout (like Zellij)
- i3-gaps style gaps and borders
- Vim-style `hjkl` navigation
- Tmux-style `Ctrl+b` prefix key
- 9 workspaces with isolated pane layouts
- Session persistence and management
- Detach/attach (leave sessions running in background)
- Pane zoom (fullscreen focused pane)
- Aggregate view for browsing/filtering PTYs across workspaces
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

## Architecture (High Level)

```
┌─────────────────────────┐
│  Host Terminal (TTY)    │
└────────────┬────────────┘
             │ input/output
             v
┌─────────────────────────┐
│ openmux UI (client)     │  Solid + OpenTUI
└────────────┬────────────┘
             │ shim protocol (detach/attach)
             v
┌─────────────────────────┐
│ shim server (background)│
└────────────┬────────────┘
             │ PTY I/O + emulation
             v
┌─────────────────────────┐
│ zig-pty + libghostty-vt │
└─────────────────────────┘
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
- `Alt+a` - Open aggregate view (browse all PTYs)
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
- `a` - Open aggregate view
- `]` - Paste from clipboard
- `d` - Detach (leave session running)
- `r` - Enter resize mode
- `?` - Toggle keyboard hints
- `Esc` - Exit prefix mode

### Resize Mode

- `h/l` - Shrink/grow width
- `j/k` - Grow/shrink height
- `Enter/Esc` - Exit resize mode

## Concepts

### Why openmux (vs tmux / zellij)

- **Single-client steal/lock**: predictable attach semantics; new client wins and old client detaches.
- **UI binary swap**: update the UI without touching running PTYs (shim stays alive).
- **UI-first architecture**: SolidJS/OpenTUI enables richer overlays and layout evolution.
- **PTY state snapshots**: fast attach with immediate state restore (no full redraw pipeline).
- **Emulator ownership**: aggregate previews, scrollback caching, and search are first-class.
- **Lower client CPU**: shim does emulation; client focuses on rendering updates.

### Workspaces

Like i3/sway, openmux supports multiple workspaces (1-9). Each workspace has its own layout tree of panes. The status bar shows populated workspaces dynamically - empty workspaces don't appear unless active.

### Layout Modes (Zellij-style)

Each workspace has a layout mode that determines how panes are arranged:

- **Vertical** (`│`): Main pane on left, stack panes split vertically on right
- **Horizontal** (`─`): Main pane on top, stack panes split horizontally on bottom
- **Stacked** (`▣`): Main pane on left, stack panes tabbed on right (only active visible)

### Sessions

Sessions persist your workspace layouts and pane working directories. Sessions are auto-saved to `~/.config/openmux/sessions/` and can be switched via the session picker (`Alt+s` or `Ctrl+b s`).

### Configuration

openmux loads `~/.config/openmux/config.toml` (or `$XDG_CONFIG_HOME/openmux/config.toml`). If the file is missing, a full default config is generated on startup. Deleting the file and restarting openmux will regenerate it.

Config changes are hot-reloaded while openmux is running (layout, theme, and keybindings update live).

See [`CONFIG.md`](CONFIG.md) for the full generated config.

Environment variables override the config file for layout values:

- `OPENMUX_WINDOW_GAP`
- `OPENMUX_MIN_PANE_WIDTH`
- `OPENMUX_MIN_PANE_HEIGHT`
- `OPENMUX_STACK_RATIO` (maps to `layout.defaultSplitRatio`)

To unbind a keybinding, set its value to `null` or `"unbind"`.

### Detach / Attach

Use `Ctrl+b d` to detach and leave the background shim running. Reattach by launching `openmux` again. Detach/attach uses a single-client lock; a new client steals the lock and the previous client detaches.

### Aggregate View

A fullscreen overlay (`Alt+a` or `Ctrl+b a`) that lets you browse all PTYs across all workspaces in one place. Features:

- **Card-style PTY list** showing directory, process name, and git branch
- **Interactive terminal preview** with full input support (keyboard + mouse)
- **Filter by typing** to search by process name, directory, or git branch
- Navigate with `j/k` or arrow keys, `Enter` to interact, `Prefix+Esc` to return to list

## Development Status

Current status:

- [x] Master-stack layout with gaps
- [x] OpenTUI component layer
- [x] Keyboard navigation system
- [x] PTY integration
- [x] libghostty-vt native terminal emulation
- [x] Workspaces (1-9)
- [x] Layout modes (vertical/horizontal/stacked)
- [x] Session persistence
- [x] Pane zoom
- [x] Mouse support
- [x] Graphics protocol passthrough (Kitty/Sixel)
- [x] Scrollback support
- [x] Aggregate view (PTY browser)
- [x] Attach/detach (steal + lock)
- [x] Configurable keybindings
- [x] Configurable settings and colors

## License

MIT
