/**
 * User configuration loader for ~/.config/openmux/config.toml.
 */

import fs from 'node:fs';
import path from 'node:path';
import * as TOML from '@iarna/toml';
import type { LayoutMode, Padding, Theme } from './types';
import { DEFAULT_CONFIG, DEFAULT_THEME } from './config';
import { DEFAULT_KEYBINDINGS, type KeybindingMap, type KeybindingsConfig } from './keybindings';

export interface LayoutSettings {
  windowGap: number;
  outerPadding: Padding;
  borderWidth: number;
  defaultLayoutMode: LayoutMode;
  defaultSplitRatio: number;
  minPaneWidth: number;
  minPaneHeight: number;
}

export interface SessionSettings {
  autoSaveIntervalMs: number;
}

export interface UserConfig {
  layout: LayoutSettings;
  theme: Theme;
  session: SessionSettings;
  keybindings: KeybindingsConfig;
}

export const DEFAULT_USER_CONFIG: UserConfig = {
  layout: {
    windowGap: DEFAULT_CONFIG.windowGap,
    outerPadding: DEFAULT_CONFIG.outerPadding,
    borderWidth: DEFAULT_CONFIG.borderWidth,
    defaultLayoutMode: DEFAULT_CONFIG.defaultLayoutMode,
    defaultSplitRatio: DEFAULT_CONFIG.defaultSplitRatio,
    minPaneWidth: DEFAULT_CONFIG.minPaneWidth,
    minPaneHeight: DEFAULT_CONFIG.minPaneHeight,
  },
  theme: DEFAULT_THEME,
  session: {
    autoSaveIntervalMs: DEFAULT_CONFIG.autoSaveInterval,
  },
  keybindings: DEFAULT_KEYBINDINGS,
};

const CONFIG_FILE_NAME = 'config.toml';

export function getConfigDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  const base = process.env.XDG_CONFIG_HOME ?? (home ? path.join(home, '.config') : path.join(process.cwd(), '.config'));
  return path.join(base, 'openmux');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

function writeDefaultConfig(configPath: string): void {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, TOML.stringify(DEFAULT_USER_CONFIG as unknown as any), 'utf8');
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function applyEnvOverrides(config: UserConfig): UserConfig {
  const overridden: UserConfig = {
    ...config,
    layout: { ...config.layout },
  };

  const windowGap = coerceNumber(process.env.OPENMUX_WINDOW_GAP);
  if (windowGap !== undefined) {
    overridden.layout.windowGap = Math.max(0, Math.floor(windowGap));
  }

  const minPaneWidth = coerceNumber(process.env.OPENMUX_MIN_PANE_WIDTH);
  if (minPaneWidth !== undefined) {
    overridden.layout.minPaneWidth = Math.max(1, Math.floor(minPaneWidth));
  }

  const minPaneHeight = coerceNumber(process.env.OPENMUX_MIN_PANE_HEIGHT);
  if (minPaneHeight !== undefined) {
    overridden.layout.minPaneHeight = Math.max(1, Math.floor(minPaneHeight));
  }

  const stackRatio = coerceNumber(process.env.OPENMUX_STACK_RATIO);
  if (stackRatio !== undefined) {
    overridden.layout.defaultSplitRatio = Math.min(0.9, Math.max(0.1, stackRatio));
  }

  return overridden;
}

function mergePadding(base: Padding, override?: Partial<Padding>): Padding {
  return {
    top: override?.top ?? base.top,
    right: override?.right ?? base.right,
    bottom: override?.bottom ?? base.bottom,
    left: override?.left ?? base.left,
  };
}

function mergeKeybindingMap(base: KeybindingMap, overrides?: KeybindingMap): KeybindingMap {
  if (!overrides) return { ...base };
  const merged: KeybindingMap = { ...base };

  for (const [combo, action] of Object.entries(overrides)) {
    if (action === null || action === false || action === 'unbind') {
      delete merged[combo];
      continue;
    }
    if (typeof action === 'string') {
      merged[combo] = action;
    }
  }

  return merged;
}

function mergeKeybindings(base: KeybindingsConfig, overrides?: Partial<KeybindingsConfig>): KeybindingsConfig {
  if (!overrides) return base;

  return {
    prefixKey: overrides.prefixKey ?? base.prefixKey,
    prefixTimeoutMs: overrides.prefixTimeoutMs ?? base.prefixTimeoutMs,
    normal: mergeKeybindingMap(base.normal, overrides.normal),
    prefix: mergeKeybindingMap(base.prefix, overrides.prefix),
    move: mergeKeybindingMap(base.move, overrides.move),
    search: mergeKeybindingMap(base.search, overrides.search),
    aggregate: {
      list: mergeKeybindingMap(base.aggregate.list, overrides.aggregate?.list),
      preview: mergeKeybindingMap(base.aggregate.preview, overrides.aggregate?.preview),
      search: mergeKeybindingMap(base.aggregate.search, overrides.aggregate?.search),
      prefix: mergeKeybindingMap(base.aggregate.prefix, overrides.aggregate?.prefix),
    },
    sessionPicker: {
      list: mergeKeybindingMap(base.sessionPicker.list, overrides.sessionPicker?.list),
      rename: mergeKeybindingMap(base.sessionPicker.rename, overrides.sessionPicker?.rename),
    },
    confirmation: mergeKeybindingMap(base.confirmation, overrides.confirmation),
  };
}

function mergeUserConfig(base: UserConfig, overrides?: Partial<UserConfig>): UserConfig {
  if (!overrides) return base;

  return {
    layout: {
      windowGap: overrides.layout?.windowGap ?? base.layout.windowGap,
      outerPadding: mergePadding(base.layout.outerPadding, overrides.layout?.outerPadding),
      borderWidth: overrides.layout?.borderWidth ?? base.layout.borderWidth,
      defaultLayoutMode: overrides.layout?.defaultLayoutMode ?? base.layout.defaultLayoutMode,
      defaultSplitRatio: overrides.layout?.defaultSplitRatio ?? base.layout.defaultSplitRatio,
      minPaneWidth: overrides.layout?.minPaneWidth ?? base.layout.minPaneWidth,
      minPaneHeight: overrides.layout?.minPaneHeight ?? base.layout.minPaneHeight,
    },
    theme: {
      pane: {
        ...base.theme.pane,
        ...overrides.theme?.pane,
      },
      statusBar: {
        ...base.theme.statusBar,
        ...overrides.theme?.statusBar,
      },
    },
    session: {
      autoSaveIntervalMs: overrides.session?.autoSaveIntervalMs ?? base.session.autoSaveIntervalMs,
    },
    keybindings: mergeKeybindings(base.keybindings, overrides.keybindings),
  };
}

export function loadUserConfigSync(options?: { createIfMissing?: boolean }): UserConfig {
  const configPath = getConfigPath();

  if (options?.createIfMissing && !fs.existsSync(configPath)) {
    writeDefaultConfig(configPath);
  }

  if (!fs.existsSync(configPath)) {
    return DEFAULT_USER_CONFIG;
  }

  try {
    const raw = TOML.parse(fs.readFileSync(configPath, 'utf8')) as Partial<UserConfig>;
    const merged = mergeUserConfig(DEFAULT_USER_CONFIG, raw);
    return applyEnvOverrides(merged);
  } catch (error) {
    console.warn('[openmux] Failed to parse config, using defaults:', error);
    return applyEnvOverrides(DEFAULT_USER_CONFIG);
  }
}
