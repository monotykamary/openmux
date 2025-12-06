# openmux

A terminal multiplexer with BSP (Binary Space Partitioning) layout, built with:

- **Bun** - Fast JavaScript runtime
- **OpenTUI** - Terminal UI library with React reconciler
- **bun-pty** - PTY support for Bun
- **libghostty-vt** (planned) - Terminal parsing via WASM

## Features

- BSP tiling layout (like bspwm/i3wm)
- i3-gaps style gaps and borders
- Vim-style `hjkl` navigation
- Tmux-style `Ctrl+b` prefix key
- Dynamic splits and pane management

## Installation

```bash
bun install
```

## Usage

```bash
bun start
```

Or with watch mode:

```bash
bun dev
```

## Keyboard Shortcuts

### Normal Mode
- `Ctrl+b` - Enter prefix mode

### Prefix Mode (2s timeout)
- `n` or `Enter` - New pane (splits based on layout mode)
- `h/j/k/l` - Navigate panes (left/down/up/right)
- `1-9` - Switch to workspace 1-9
- `v` - Set layout mode: vertical (side by side)
- `s` - Set layout mode: horizontal (stacked)
- `t` - Set layout mode: tabbed/stacked
- `x` - Close current pane
- `r` - Enter resize mode
- `?` - Toggle keyboard hints
- `Esc` - Exit prefix mode

### Resize Mode
- `h/l` - Shrink/grow width
- `j/k` - Grow/shrink height
- `Enter/Esc` - Exit resize mode

## Concepts

### Workspaces
Like i3/sway, openmux supports multiple workspaces (1-9). Each workspace has its own BSP tree of panes. The status bar shows populated workspaces dynamically - empty workspaces don't appear unless active.

### Layout Modes (Zellij-style)
Each workspace has a layout mode that determines how panes are arranged:
- **Vertical** (`│`): Main pane on left, new panes stack vertically on right (equal height)
- **Horizontal** (`─`): Main pane on top, new panes stack horizontally on bottom (equal width)
- **Stacked** (`▣`): Main pane on left, new panes tabbed on right (only active visible)

## Project Structure

```
src/
├── core/           # BSP tree implementation
│   ├── types.ts    # Type definitions
│   ├── bsp-tree.ts # BSP tree class
│   ├── config.ts   # Configuration
│   └── operations/ # Insert, remove, layout, resize, navigate
├── components/     # OpenTUI React components
├── contexts/       # React contexts (Layout, Keyboard, Theme)
├── terminal/       # PTY management and terminal parsing
└── index.tsx       # Entry point
```

## Development Status

This is a proof of concept. Current status:

- [x] BSP tree data structures
- [x] Layout calculation with gaps
- [x] OpenTUI component layer
- [x] Keyboard navigation system
- [x] PTY integration (basic)
- [ ] libghostty-vt WASM integration
- [ ] Full terminal emulation
- [ ] Scrollback support
- [ ] Session persistence

## License

MIT
