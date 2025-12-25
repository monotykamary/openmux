/**
 * Config context - loads ~/.config/openmux/config.toml and watches for changes.
 */

import { createContext, createMemo, createSignal, onCleanup, onMount, useContext, type ParentProps, type Accessor } from 'solid-js';
import fs from 'node:fs';
import path from 'node:path';
import { getConfigPath, loadUserConfigSync, type UserConfig } from '../core/user-config';
import { resolveKeybindings, type ResolvedKeybindings } from '../core/keybindings';

interface ConfigContextValue {
  config: Accessor<UserConfig>;
  keybindings: Accessor<ResolvedKeybindings>;
  configPath: string;
  reloadConfig: () => void;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider(props: ParentProps) {
  const configPath = getConfigPath();
  const [config, setConfig] = createSignal<UserConfig>(
    loadUserConfigSync({ createIfMissing: true })
  );

  const keybindings = createMemo(() => resolveKeybindings(config().keybindings));

  const reloadConfig = () => {
    const next = loadUserConfigSync();
    setConfig(next);
  };

  onMount(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const configDir = path.dirname(configPath);
    const configFile = path.basename(configPath);

    const scheduleReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        reloadConfig();
      }, 50);
    };

    let watcher: fs.FSWatcher | null = null;
    try {
      watcher = fs.watch(configDir, { persistent: false }, (_eventType, filename) => {
        if (!filename) {
          scheduleReload();
          return;
        }
        const name = filename.toString();
        if (name === configFile) {
          scheduleReload();
        }
      });
    } catch (error) {
      console.warn('[openmux] Config watch failed:', error);
    }

    onCleanup(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      watcher?.close();
    });
  });

  return (
    <ConfigContext.Provider value={{ config, keybindings, configPath, reloadConfig }}>
      {props.children}
    </ConfigContext.Provider>
  );
}

export function useConfig(): ConfigContextValue {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error('useConfig must be used within ConfigProvider');
  }
  return context;
}
