# Configuration

This document is generated from the default openmux config.

It mirrors the file created at:
- `~/.config/openmux/config.toml`
- `$XDG_CONFIG_HOME/openmux/config.toml` (if set)

Regenerate with:

```bash
bun scripts/generate-config-doc.ts
```

```toml
[layout]
windowGap = 0
borderWidth = 1
defaultLayoutMode = "vertical"
defaultSplitRatio = 0.5
minPaneWidth = 10
minPaneHeight = 5

  [layout.outerPadding]
  top = 0
  right = 0
  bottom = 0
  left = 0

[theme.pane]
borderColor = "#444444"
focusedBorderColor = "#00AAFF"
urgentBorderColor = "#FF5500"
borderStyle = "rounded"
innerGap = 1
outerGap = 1
titleColor = "#888888"
focusedTitleColor = "#FFFFFF"

[theme.statusBar]
backgroundColor = "#1a1a1a"
foregroundColor = "#CCCCCC"
activeTabColor = "#00AAFF"
inactiveTabColor = "#666666"

[session]
autoSaveIntervalMs = 30_000

[keybindings]
prefixKey = "ctrl+b"
prefixTimeoutMs = 2_000

  [keybindings.normal]
  "alt+h" = "pane.focus.west"
  "alt+j" = "pane.focus.south"
  "alt+k" = "pane.focus.north"
  "alt+l" = "pane.focus.east"
  "alt+m" = "mode.move"
  "alt+n" = "pane.new"
  "alt+enter" = "pane.new"
  "alt+s" = "session.picker.toggle"
  "alt+g" = "aggregate.toggle"
  "alt+f" = "search.open"
  "alt+[" = "layout.cycle.prev"
  "alt+]" = "layout.cycle.next"
  "alt+z" = "pane.zoom"
  "alt+x" = "pane.close"
  "alt+1" = "workspace.switch.1"
  "alt+2" = "workspace.switch.2"
  "alt+3" = "workspace.switch.3"
  "alt+4" = "workspace.switch.4"
  "alt+5" = "workspace.switch.5"
  "alt+6" = "workspace.switch.6"
  "alt+7" = "workspace.switch.7"
  "alt+8" = "workspace.switch.8"
  "alt+9" = "workspace.switch.9"

  [keybindings.prefix]
  1 = "workspace.switch.1"
  2 = "workspace.switch.2"
  3 = "workspace.switch.3"
  4 = "workspace.switch.4"
  5 = "workspace.switch.5"
  6 = "workspace.switch.6"
  7 = "workspace.switch.7"
  8 = "workspace.switch.8"
  9 = "workspace.switch.9"
  h = "pane.focus.west"
  j = "pane.focus.south"
  k = "pane.focus.north"
  l = "pane.focus.east"
  m = "mode.move"
  n = "pane.new"
  enter = "pane.new"
  x = "pane.close"
  v = "layout.mode.vertical"
  "shift+h" = "layout.mode.horizontal"
  t = "layout.mode.stacked"
  s = "session.picker.toggle"
  g = "aggregate.toggle"
  "/" = "search.open"
  z = "pane.zoom"
  "]" = "clipboard.paste"
  p = "clipboard.paste"
  "`" = "console.toggle"
  q = "app.quit"
  d = "app.detach"
  "?" = "hints.toggle"
  escape = "mode.cancel"

  [keybindings.move]
  h = "pane.move.west"
  j = "pane.move.south"
  k = "pane.move.north"
  l = "pane.move.east"
  escape = "mode.cancel"

  [keybindings.search]
  "ctrl+n" = "search.next"
  "ctrl+shift+n" = "search.prev"
  "ctrl+p" = "search.prev"
  enter = "search.confirm"
  escape = "search.cancel"
  backspace = "search.delete"

[keybindings.aggregate.list]
down = "aggregate.list.down"
j = "aggregate.list.down"
up = "aggregate.list.up"
k = "aggregate.list.up"
enter = "aggregate.list.preview"
tab = "aggregate.list.jump"
"alt+escape" = "aggregate.list.close"
"alt+x" = "aggregate.kill"
backspace = "aggregate.list.delete"

[keybindings.aggregate.preview]
"alt+escape" = "aggregate.preview.exit"
"alt+f" = "aggregate.preview.search"
"alt+x" = "aggregate.kill"

[keybindings.aggregate.search]
enter = "aggregate.search.confirm"
escape = "aggregate.search.cancel"
"ctrl+n" = "aggregate.search.next"
"ctrl+shift+n" = "aggregate.search.prev"
"ctrl+p" = "aggregate.search.prev"
backspace = "aggregate.search.delete"

[keybindings.aggregate.prefix]
q = "aggregate.prefix.quit"
d = "aggregate.prefix.detach"
escape = "aggregate.prefix.exit"
"/" = "aggregate.prefix.search"

[keybindings.sessionPicker.list]
escape = "session.picker.close"
down = "session.picker.down"
up = "session.picker.up"
enter = "session.picker.select"
backspace = "session.picker.filter.delete"
"ctrl+n" = "session.picker.create"
"ctrl+r" = "session.picker.rename"
"ctrl+x" = "session.picker.delete"
"ctrl+d" = "session.picker.delete"

[keybindings.sessionPicker.rename]
escape = "session.picker.rename.cancel"
enter = "session.picker.rename.confirm"
backspace = "session.picker.rename.delete"

  [keybindings.confirmation]
  escape = "confirm.cancel"
  enter = "confirm.accept"
  left = "confirm.focus.confirm"
  h = "confirm.focus.confirm"
  right = "confirm.focus.cancel"
  l = "confirm.focus.cancel"
  tab = "confirm.focus.cancel"
```
