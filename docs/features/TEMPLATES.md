# Templates

Templates capture the current session layout (workspaces, layout modes, pane CWDs, and foreground process hints) so you can reapply it later.

## Open the templates overlay

- Normal mode: `alt+t`
- Prefix mode: `ctrl+b` then `Shift+T` (prefix key is configurable)
- Command palette: select "Templates"

## Apply a template

1. Open the overlay (Apply tab).
2. Use Up/Down to select a template.
3. Press Enter to apply.
4. If your layout is not empty, confirm in the dialog.

## Save a template

1. Open the overlay and press Tab to switch to the Save tab.
2. Type a name, then press Enter to save.
3. If a template with the same name exists, confirm overwrite.

## Delete a template

1. Open the overlay (Apply tab).
2. Select a template and press `ctrl+d` (or `ctrl+x`).
3. Confirm deletion in the dialog.

## Overlay keys (defaults)

Apply tab:
- Up/Down: move selection
- Enter: apply
- `ctrl+d` or `ctrl+x`: delete
- Tab: switch to Save tab
- Escape: close

Save tab:
- Enter: save
- Backspace: delete character
- Tab: switch to Apply tab
- Escape: close

## Storage

Templates are stored as JSON in `~/.config/openmux/templates/` (or `$XDG_CONFIG_HOME/openmux/templates` if set).
