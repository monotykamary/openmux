/**
 * CommandPalette - modal overlay for command search and execution
 */

import { Show, For, createMemo, createEffect, onCleanup } from 'solid-js';
import { type SetStoreFunction } from 'solid-js/store';
import { useConfig } from '../contexts/ConfigContext';
import { useTheme } from '../contexts/ThemeContext';
import { registerKeyboardHandler } from '../effect/bridge';
import { matchKeybinding } from '../core/keybindings';
import type { CommandPaletteCommand } from '../core/command-palette';

export interface CommandPaletteState {
  show: boolean;
  query: string;
  selectedIndex: number;
}

interface CommandPaletteProps {
  width: number;
  height: number;
  commands: CommandPaletteCommand[];
  state: CommandPaletteState;
  setState: SetStoreFunction<CommandPaletteState>;
  onExecute: (command: CommandPaletteCommand) => void;
}

function filterCommands(commands: CommandPaletteCommand[], query: string): CommandPaletteCommand[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];

  const terms = trimmed.split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  return commands.filter((command) => {
    const haystack = [
      command.title,
      command.description ?? '',
      command.action,
      ...(command.keywords ?? []),
    ].join(' ').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function CommandPalette(props: CommandPaletteProps) {
  const config = useConfig();
  const theme = useTheme();

  const hasQuery = () => props.state.query.trim().length > 0;
  const filteredCommands = createMemo(() => filterCommands(props.commands, props.state.query));
  const accentColor = () => theme.commandPalette.borderColor;
  const resultCount = () => filteredCommands().length;
  const showResults = () => resultCount() > 0;

  const closePalette = () => {
    props.setState({ show: false, query: '', selectedIndex: 0 });
  };

  const updateQuery = (query: string) => {
    props.setState({ query, selectedIndex: 0 });
  };

  const moveSelection = (direction: 'up' | 'down') => {
    const count = filteredCommands().length;
    if (count === 0) return;

    const delta = direction === 'down' ? 1 : -1;
    const nextIndex = (props.state.selectedIndex + delta + count) % count;
    props.setState('selectedIndex', nextIndex);
  };

  const executeSelected = () => {
    const command = filteredCommands()[props.state.selectedIndex];
    if (!command) return;
    closePalette();
    props.onExecute(command);
  };

  const handleKeyDown = (event: {
    key: string;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
    sequence?: string;
  }) => {
    if (!props.state.show) return false;

    const bindings = config.keybindings().commandPalette;
    const action = matchKeybinding(bindings, {
      key: event.key,
      ctrl: event.ctrl,
      alt: event.alt,
      shift: event.shift,
    });

    switch (action) {
      case 'command.palette.close':
        closePalette();
        return true;
      case 'command.palette.down':
        moveSelection('down');
        return true;
      case 'command.palette.up':
        moveSelection('up');
        return true;
      case 'command.palette.confirm':
        executeSelected();
        return true;
      case 'command.palette.delete':
        updateQuery(props.state.query.slice(0, -1));
        return true;
      default:
        break;
    }

    const input = event.sequence ?? (event.key.length === 1 ? event.key : '');
    const charCode = input.charCodeAt(0) ?? 0;
    const isPrintable = input.length === 1 && charCode >= 32 && charCode < 127;
    if (isPrintable && !event.ctrl && !event.alt) {
      updateQuery(props.state.query + input);
      return true;
    }

    return true;
  };

  createEffect(() => {
    const unsubscribe = registerKeyboardHandler('commandPalette', handleKeyDown);
    onCleanup(() => unsubscribe());
  });

  createEffect(() => {
    const count = resultCount();
    if (props.state.selectedIndex >= count) {
      props.setState('selectedIndex', Math.max(0, count - 1));
    }
  });

  const overlayWidth = () => Math.min(70, props.width - 4);
  const innerWidth = () => Math.max(1, overlayWidth() - 4);

  const listHeight = () => {
    if (!showResults()) return 0;
    const maxRows = Math.max(1, props.height - 7);
    const rowCount = resultCount();
    return Math.min(Math.max(1, rowCount), maxRows);
  };

  const overlayHeight = () => {
    if (!hasQuery()) return 3;
    if (!showResults()) return 3;
    return Math.min(listHeight() + 3, props.height - 4);
  };
  const overlayX = () => Math.floor((props.width - overlayWidth()) / 2);
  const overlayY = () => {
    const desiredCommandY = Math.floor(props.height * 0.15);
    const desired = Math.max(0, desiredCommandY - 1);
    const maxY = Math.max(0, props.height - overlayHeight());
    return Math.min(desired, maxY);
  };

  const listStartIndex = createMemo(() => {
    if (!showResults()) return 0;
    const count = resultCount();
    const visible = listHeight();
    if (count <= visible || visible === 0) return 0;
    const half = Math.floor(visible / 2);
    return Math.min(
      Math.max(0, props.state.selectedIndex - half),
      Math.max(0, count - visible)
    );
  });

  const visibleCommands = createMemo(() => {
    if (!showResults()) return [];
    const start = listStartIndex();
    return filteredCommands().slice(start, start + listHeight());
  });

  const matchDisplay = () => {
    if (!hasQuery()) return '';
    if (resultCount() === 0) return '0 matches';
    return `${props.state.selectedIndex + 1}/${resultCount()}`;
  };

  return (
    <Show when={props.state.show}>
      <box
        style={{
          position: 'absolute',
          left: overlayX(),
          top: overlayY(),
          width: overlayWidth(),
          height: overlayHeight(),
          border: true,
          borderStyle: 'rounded',
          borderColor: accentColor(),
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 0,
          paddingBottom: 0,
          zIndex: 160,
        }}
        backgroundColor="#1a1a1a"
        title=" Command Palette "
        titleAlignment="center"
      >
        <box style={{ flexDirection: 'column' }}>
          <box style={{ flexDirection: 'row', height: 1 }}>
            <text fg={accentColor()}>{'> '}</text>
            <text fg="#FFFFFF">{props.state.query || ' '}</text>
            <text fg={accentColor()}>_</text>
            <text fg="#444444">  </text>
            <text fg={resultCount() > 0 ? '#88FF88' : '#888888'}>{matchDisplay()}</text>
            <text fg="#444444">  </text>
            <text fg="#666666">Up/Down:nav Enter:run Esc:close</text>
          </box>

          <Show when={visibleCommands().length > 0}>
            <For each={visibleCommands()}>
              {(command, index) => (
                <box style={{ height: 1 }}>
                  <CommandRow
                    command={command}
                    isSelected={listStartIndex() + index() === props.state.selectedIndex}
                    maxWidth={innerWidth()}
                  />
                </box>
              )}
            </For>
          </Show>
        </box>
      </box>
    </Show>
  );
}

interface CommandRowProps {
  command: CommandPaletteCommand;
  isSelected: boolean;
  maxWidth: number;
}

function fitLine(text: string, width: number): string {
  if (width <= 0) return '';
  if (text.length > width) {
    if (width <= 3) return text.slice(0, width);
    return text.slice(0, width - 3) + '...';
  }
  return text.padEnd(width);
}

function CommandRow(props: CommandRowProps) {
  const marker = () => (props.isSelected ? '>' : ' ');
  const details = () => props.command.description ? ` - ${props.command.description}` : '';
  const line = () => fitLine(`${marker()} ${props.command.title}${details()}`, props.maxWidth);
  const fg = () => props.isSelected ? '#FFFFFF' : '#CCCCCC';
  const bg = () => props.isSelected ? '#334455' : undefined;

  return (
    <text fg={fg()} bg={bg()}>
      {line()}
    </text>
  );
}
