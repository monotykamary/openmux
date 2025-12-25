export interface CommandPaletteCommand {
  id: string;
  title: string;
  description?: string;
  action: string;
  keywords?: string[];
}

const BASE_COMMANDS: CommandPaletteCommand[] = [
  {
    id: 'pane.new',
    title: 'New pane',
    description: 'Create a new pane',
    action: 'pane.new',
    keywords: ['split', 'new'],
  },
  {
    id: 'pane.close',
    title: 'Close pane',
    description: 'Close the focused pane',
    action: 'pane.close',
    keywords: ['close', 'kill'],
  },
  {
    id: 'pane.zoom',
    title: 'Toggle zoom',
    description: 'Zoom or unzoom the focused pane',
    action: 'pane.zoom',
    keywords: ['zoom', 'pane'],
  },
  {
    id: 'pane.focus.west',
    title: 'Focus pane left',
    description: 'Move focus to the pane on the left',
    action: 'pane.focus.west',
    keywords: ['focus', 'left', 'west'],
  },
  {
    id: 'pane.focus.east',
    title: 'Focus pane right',
    description: 'Move focus to the pane on the right',
    action: 'pane.focus.east',
    keywords: ['focus', 'right', 'east'],
  },
  {
    id: 'pane.focus.north',
    title: 'Focus pane up',
    description: 'Move focus to the pane above',
    action: 'pane.focus.north',
    keywords: ['focus', 'up', 'north'],
  },
  {
    id: 'pane.focus.south',
    title: 'Focus pane down',
    description: 'Move focus to the pane below',
    action: 'pane.focus.south',
    keywords: ['focus', 'down', 'south'],
  },
  {
    id: 'mode.move',
    title: 'Move pane mode',
    description: 'Enter pane move mode',
    action: 'mode.move',
    keywords: ['move', 'pane'],
  },
  {
    id: 'layout.mode.vertical',
    title: 'Layout: vertical',
    description: 'Main pane left, stack on the right',
    action: 'layout.mode.vertical',
    keywords: ['layout', 'vertical'],
  },
  {
    id: 'layout.mode.horizontal',
    title: 'Layout: horizontal',
    description: 'Main pane top, stack on the bottom',
    action: 'layout.mode.horizontal',
    keywords: ['layout', 'horizontal'],
  },
  {
    id: 'layout.mode.stacked',
    title: 'Layout: stacked',
    description: 'Main pane left, stack as tabs',
    action: 'layout.mode.stacked',
    keywords: ['layout', 'stacked', 'tabs'],
  },
  {
    id: 'layout.cycle.next',
    title: 'Cycle layout next',
    description: 'Move to the next layout mode',
    action: 'layout.cycle.next',
    keywords: ['layout', 'cycle', 'next'],
  },
  {
    id: 'layout.cycle.prev',
    title: 'Cycle layout previous',
    description: 'Move to the previous layout mode',
    action: 'layout.cycle.prev',
    keywords: ['layout', 'cycle', 'previous'],
  },
  {
    id: 'search.open',
    title: 'Search scrollback',
    description: 'Search the focused pane scrollback',
    action: 'search.open',
    keywords: ['search', 'find', 'scrollback'],
  },
  {
    id: 'session.picker.toggle',
    title: 'Session picker',
    description: 'Open the session picker',
    action: 'session.picker.toggle',
    keywords: ['session', 'picker'],
  },
  {
    id: 'aggregate.toggle',
    title: 'Aggregate view',
    description: 'Open global PTY list',
    action: 'aggregate.toggle',
    keywords: ['aggregate', 'global'],
  },
  {
    id: 'clipboard.paste',
    title: 'Paste',
    description: 'Paste from clipboard',
    action: 'clipboard.paste',
    keywords: ['paste', 'clipboard'],
  },
  {
    id: 'hints.toggle',
    title: 'Toggle keyboard hints',
    description: 'Show or hide keyboard hints',
    action: 'hints.toggle',
    keywords: ['hints', 'help', 'keys'],
  },
  {
    id: 'console.toggle',
    title: 'Toggle debug console',
    description: 'Show or hide the debug console',
    action: 'console.toggle',
    keywords: ['console', 'debug'],
  },
  {
    id: 'app.detach',
    title: 'Detach',
    description: 'Detach the current client',
    action: 'app.detach',
    keywords: ['detach'],
  },
  {
    id: 'app.quit',
    title: 'Quit openmux',
    description: 'Exit and terminate all panes',
    action: 'app.quit',
    keywords: ['quit', 'exit'],
  },
];

const WORKSPACE_COMMANDS: CommandPaletteCommand[] = Array.from({ length: 9 }, (_, i) => {
  const id = `workspace.switch.${i + 1}`;
  return {
    id,
    title: `Switch to workspace ${i + 1}`,
    description: `Focus workspace ${i + 1}`,
    action: id,
    keywords: ['workspace', 'switch', String(i + 1)],
  };
});

export const DEFAULT_COMMAND_PALETTE_COMMANDS: CommandPaletteCommand[] = [
  ...BASE_COMMANDS,
  ...WORKSPACE_COMMANDS,
];
