/**
 * Keybinding parsing, matching, and formatting utilities.
 */

export interface KeybindingEvent {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export type KeybindingMap = Record<string, string | null | undefined | false>;

export interface KeybindingsConfig {
  prefixKey: string;
  prefixTimeoutMs: number;
  normal: KeybindingMap;
  prefix: KeybindingMap;
  move: KeybindingMap;
  search: KeybindingMap;
  commandPalette: KeybindingMap;
  templateOverlay: {
    apply: KeybindingMap;
    save: KeybindingMap;
  };
  aggregate: {
    list: KeybindingMap;
    preview: KeybindingMap;
    search: KeybindingMap;
    prefix: KeybindingMap;
  };
  sessionPicker: {
    list: KeybindingMap;
    rename: KeybindingMap;
  };
  confirmation: KeybindingMap;
}

export interface ResolvedKeybindingMap {
  byCombo: Map<string, string>;
  byAction: Map<string, string[]>;
}

export interface ResolvedKeybindings {
  prefixKey: string;
  prefixTimeoutMs: number;
  normal: ResolvedKeybindingMap;
  prefix: ResolvedKeybindingMap;
  move: ResolvedKeybindingMap;
  search: ResolvedKeybindingMap;
  commandPalette: ResolvedKeybindingMap;
  templateOverlay: {
    apply: ResolvedKeybindingMap;
    save: ResolvedKeybindingMap;
  };
  aggregate: {
    list: ResolvedKeybindingMap;
    preview: ResolvedKeybindingMap;
    search: ResolvedKeybindingMap;
    prefix: ResolvedKeybindingMap;
  };
  sessionPicker: {
    list: ResolvedKeybindingMap;
    rename: ResolvedKeybindingMap;
  };
  confirmation: ResolvedKeybindingMap;
}

export const DEFAULT_KEYBINDINGS: KeybindingsConfig = {
  prefixKey: 'ctrl+b',
  prefixTimeoutMs: 2000,
  normal: {
    'alt+h': 'pane.focus.west',
    'alt+j': 'pane.focus.south',
    'alt+k': 'pane.focus.north',
    'alt+l': 'pane.focus.east',
    'alt+m': 'mode.move',
    'alt+n': 'pane.new',
    'alt+s': 'session.picker.toggle',
    'alt+g': 'aggregate.toggle',
    'alt+f': 'search.open',
    'alt+p': 'command.palette.toggle',
    'alt+[': 'layout.cycle.prev',
    'alt+]': 'layout.cycle.next',
    'alt+z': 'pane.zoom',
    'alt+x': 'pane.close',
    ...Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`alt+${i + 1}`, `workspace.switch.${i + 1}`])
    ),
  },
  prefix: {
    'h': 'pane.focus.west',
    'j': 'pane.focus.south',
    'k': 'pane.focus.north',
    'l': 'pane.focus.east',
    'm': 'mode.move',
    'n': 'pane.new',
    'enter': 'pane.new',
    'x': 'pane.close',
    'v': 'layout.mode.vertical',
    'shift+h': 'layout.mode.horizontal',
    't': 'layout.mode.stacked',
    's': 'session.picker.toggle',
    'g': 'aggregate.toggle',
    '/': 'search.open',
    ':': 'command.palette.toggle',
    'z': 'pane.zoom',
    ']': 'clipboard.paste',
    'p': 'clipboard.paste',
    '`': 'console.toggle',
    'q': 'app.quit',
    'd': 'app.detach',
    '?': 'hints.toggle',
    'escape': 'mode.cancel',
    ...Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`${i + 1}`, `workspace.switch.${i + 1}`])
    ),
  },
  move: {
    'h': 'pane.move.west',
    'j': 'pane.move.south',
    'k': 'pane.move.north',
    'l': 'pane.move.east',
    'escape': 'mode.cancel',
  },
  search: {
    'ctrl+n': 'search.next',
    'ctrl+p': 'search.prev',
    'enter': 'search.confirm',
    'escape': 'search.cancel',
    'backspace': 'search.delete',
  },
  commandPalette: {
    'down': 'command.palette.down',
    'up': 'command.palette.up',
    'enter': 'command.palette.confirm',
    'escape': 'command.palette.close',
    'backspace': 'command.palette.delete',
  },
  templateOverlay: {
    apply: {
      'escape': 'template.close',
      'tab': 'template.tab.save',
      'down': 'template.list.down',
      'j': 'template.list.down',
      'up': 'template.list.up',
      'k': 'template.list.up',
      'enter': 'template.apply',
      'x': 'template.delete',
      'ctrl+d': 'template.delete',
    },
    save: {
      'escape': 'template.close',
      'tab': 'template.tab.apply',
      'enter': 'template.save',
      'backspace': 'template.save.delete',
    },
  },
  aggregate: {
    list: {
      'down': 'aggregate.list.down',
      'j': 'aggregate.list.down',
      'up': 'aggregate.list.up',
      'k': 'aggregate.list.up',
      'enter': 'aggregate.list.preview',
      'tab': 'aggregate.list.jump',
      'alt+escape': 'aggregate.list.close',
      'alt+x': 'aggregate.kill',
      'backspace': 'aggregate.list.delete',
    },
    preview: {
      'alt+escape': 'aggregate.preview.exit',
      'alt+f': 'aggregate.preview.search',
      'alt+x': 'aggregate.kill',
    },
    search: {
      'enter': 'aggregate.search.confirm',
      'escape': 'aggregate.search.cancel',
      'ctrl+n': 'aggregate.search.next',
      'ctrl+p': 'aggregate.search.prev',
      'backspace': 'aggregate.search.delete',
    },
    prefix: {
      'q': 'aggregate.prefix.quit',
      'd': 'aggregate.prefix.detach',
      'escape': 'aggregate.prefix.exit',
      '/': 'aggregate.prefix.search',
    },
  },
  sessionPicker: {
    list: {
      'escape': 'session.picker.close',
      'down': 'session.picker.down',
      'up': 'session.picker.up',
      'enter': 'session.picker.select',
      'backspace': 'session.picker.filter.delete',
      'ctrl+n': 'session.picker.create',
      'ctrl+r': 'session.picker.rename',
      'ctrl+x': 'session.picker.delete',
      'ctrl+d': 'session.picker.delete',
    },
    rename: {
      'escape': 'session.picker.rename.cancel',
      'enter': 'session.picker.rename.confirm',
      'backspace': 'session.picker.rename.delete',
    },
  },
  confirmation: {
    'escape': 'confirm.cancel',
    'enter': 'confirm.accept',
    'left': 'confirm.focus.confirm',
    'h': 'confirm.focus.confirm',
    'right': 'confirm.focus.cancel',
    'l': 'confirm.focus.cancel',
    'tab': 'confirm.focus.cancel',
  },
};

const MODIFIER_ALIASES: Record<string, 'ctrl' | 'alt' | 'shift' | 'meta'> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  ctl: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta',
};

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  escape: 'escape',
  return: 'enter',
  enter: 'enter',
  kp_enter: 'enter',
  backspace: 'backspace',
  bs: 'backspace',
  tab: 'tab',
  space: 'space',
  spacebar: 'space',
  del: 'delete',
  delete: 'delete',
  pgup: 'pageup',
  pageup: 'pageup',
  pgdn: 'pagedown',
  pagedown: 'pagedown',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  plus: '+',
  minus: '-',
};

const MODIFIER_ORDER: Array<keyof Pick<KeybindingEvent, 'ctrl' | 'alt' | 'shift' | 'meta'>> = [
  'ctrl',
  'alt',
  'shift',
  'meta',
];

interface ParsedCombo {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

function normalizeKeyName(rawKey: string): { key: string; shift: boolean } {
  if (rawKey === ' ') {
    return { key: 'space', shift: false };
  }

  let key = rawKey.trim();
  if (!key) {
    return { key: '', shift: false };
  }

  let shift = false;

  if (key.length === 1) {
    const lower = key.toLowerCase();
    if (key !== lower) {
      shift = true;
      key = lower;
    }
    return { key, shift };
  }

  const lower = key.toLowerCase();
  return {
    key: KEY_ALIASES[lower] ?? lower,
    shift,
  };
}

function shouldDropShift(key: string): boolean {
  return key.length === 1 && !/[a-z]/.test(key);
}

function toComboString(parsed: ParsedCombo): string {
  const parts: string[] = [];
  for (const mod of MODIFIER_ORDER) {
    if (parsed[mod]) {
      parts.push(mod);
    }
  }
  parts.push(parsed.key);
  return parts.join('+');
}

function parseComboString(combo: string): ParsedCombo | null {
  const parts = combo.split('+').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  let key = '';
  let sawModifier = false;

  for (const part of parts) {
    const lower = part.toLowerCase();
    const modifier = MODIFIER_ALIASES[lower];
    if (modifier) {
      sawModifier = true;
      if (modifier === 'ctrl') ctrl = true;
      if (modifier === 'alt') alt = true;
      if (modifier === 'shift') shift = true;
      if (modifier === 'meta') meta = true;
      continue;
    }

    if (key) {
      return null;
    }

    const normalized = normalizeKeyName(part);
    key = normalized.key;
    if (!sawModifier) {
      shift = shift || normalized.shift;
    }
  }

  if (!key) {
    return null;
  }

  if (shouldDropShift(key)) {
    shift = false;
  }

  return { key, ctrl, alt, shift, meta };
}

export function normalizeKeyCombo(combo: string): string | null {
  const parsed = parseComboString(combo);
  if (!parsed) return null;
  return toComboString(parsed);
}

export function eventToCombo(event: KeybindingEvent): string {
  const normalized = normalizeKeyName(event.key);
  let shift = !!event.shift || normalized.shift;
  const key = normalized.key || event.key.toLowerCase();

  if (shouldDropShift(key)) {
    shift = false;
  }

  return toComboString({
    key,
    ctrl: !!event.ctrl,
    alt: !!event.alt,
    shift,
    meta: !!event.meta,
  });
}

export function resolveKeybindingMap(map: KeybindingMap): ResolvedKeybindingMap {
  const byCombo = new Map<string, string>();
  const byAction = new Map<string, string[]>();

  for (const [combo, action] of Object.entries(map)) {
    if (!action || action === 'unbind') {
      continue;
    }

    const normalized = normalizeKeyCombo(combo);
    if (!normalized) {
      continue;
    }

    byCombo.set(normalized, action);

    const existing = byAction.get(action) ?? [];
    if (!existing.includes(normalized)) {
      existing.push(normalized);
      byAction.set(action, existing);
    }
  }

  return { byCombo, byAction };
}

export function resolveKeybindings(config: KeybindingsConfig): ResolvedKeybindings {
  const prefixKey = normalizeKeyCombo(config.prefixKey) ?? 'ctrl+b';

  return {
    prefixKey,
    prefixTimeoutMs: config.prefixTimeoutMs,
    normal: resolveKeybindingMap(config.normal),
    prefix: resolveKeybindingMap(config.prefix),
    move: resolveKeybindingMap(config.move),
    search: resolveKeybindingMap(config.search),
    commandPalette: resolveKeybindingMap(config.commandPalette),
    templateOverlay: {
      apply: resolveKeybindingMap(config.templateOverlay.apply),
      save: resolveKeybindingMap(config.templateOverlay.save),
    },
    aggregate: {
      list: resolveKeybindingMap(config.aggregate.list),
      preview: resolveKeybindingMap(config.aggregate.preview),
      search: resolveKeybindingMap(config.aggregate.search),
      prefix: resolveKeybindingMap(config.aggregate.prefix),
    },
    sessionPicker: {
      list: resolveKeybindingMap(config.sessionPicker.list),
      rename: resolveKeybindingMap(config.sessionPicker.rename),
    },
    confirmation: resolveKeybindingMap(config.confirmation),
  };
}

export function matchKeybinding(
  bindings: ResolvedKeybindingMap,
  event: KeybindingEvent
): string | null {
  const combo = eventToCombo(event);
  return bindings.byCombo.get(combo) ?? null;
}

function formatKeyName(key: string): string {
  switch (key) {
    case 'escape':
      return 'esc';
    case 'enter':
      return 'enter';
    case 'backspace':
      return 'backspace';
    case 'delete':
      return 'delete';
    case 'tab':
      return 'tab';
    case 'space':
      return 'space';
    case 'pageup':
      return 'pageup';
    case 'pagedown':
      return 'pagedown';
    case 'left':
      return '\u2190';
    case 'right':
      return '\u2192';
    case 'up':
      return '\u2191';
    case 'down':
      return '\u2193';
    default:
      return key.toLowerCase();
  }
}

function formatModifiers(mods: ParsedCombo): string {
  const labels: string[] = [];
  if (mods.ctrl) labels.push('^');
  if (mods.alt) labels.push('\u2325');
  if (mods.shift) labels.push('\u21e7');
  if (mods.meta) labels.push('\u2318');
  return labels.join('');
}

export function formatKeyCombo(combo: string): string {
  const parsed = parseComboString(combo);
  if (!parsed) return combo;
  const mods = formatModifiers(parsed);
  const key = formatKeyName(parsed.key);
  return mods ? `${mods}${key}` : key;
}

export function formatComboSet(combos: string[]): string {
  if (!combos.length) return '--';

  const parsed = combos.map(parseComboString).filter(Boolean) as ParsedCombo[];
  if (parsed.length === 0) return '--';

  const modKey = formatModifiers(parsed[0]);
  const sameMods = parsed.every((combo) => formatModifiers(combo) === modKey);
  const keys = parsed.map((combo) => combo.key);

  if (sameMods) {
    const uniqueKeys = Array.from(new Set(keys));

    if (uniqueKeys.length === 9 && uniqueKeys.every((key) => /^[1-9]$/.test(key))) {
      return modKey ? `${modKey}1-9` : '1-9';
    }

    const isHjkl = ['h', 'j', 'k', 'l'].every((key) => uniqueKeys.includes(key));
    if (isHjkl) {
      return modKey ? `${modKey}hjkl` : 'hjkl';
    }

    const isArrows = ['up', 'down', 'left', 'right'].every((key) => uniqueKeys.includes(key));
    if (isArrows) {
      const arrowLabel = ['up', 'down', 'left', 'right'].map((key) => formatKeyName(key)).join('/');
      return modKey ? `${modKey}${arrowLabel}` : arrowLabel;
    }

    const isBracketPair = uniqueKeys.length === 2 && uniqueKeys.includes('[') && uniqueKeys.includes(']');
    if (isBracketPair) {
      return modKey ? `${modKey}[/]` : '[/]';
    }

    const keyLabels = uniqueKeys.map((key) => formatKeyName(key));
    const combinedKeys = keyLabels.join('/');
    return modKey ? `${modKey}${combinedKeys}` : combinedKeys;
  }

  return combos.map(formatKeyCombo).join('/');
}
