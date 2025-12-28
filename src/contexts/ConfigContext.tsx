/**
 * Config context - loads ~/.config/openmux/config.toml and watches for changes.
 */

import { createContext, createMemo, createSignal, onCleanup, onMount, useContext, type ParentProps, type Accessor } from 'solid-js';
import { Effect, Stream, Duration } from 'effect';
import fs from 'node:fs';
import path from 'node:path';
import { getConfigPath, loadUserConfigSync, type UserConfig } from '../core/user-config';
import { resolveKeybindings, type ResolvedKeybindings } from '../core/keybindings';
import { runStream } from '../effect/stream-utils';

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
    const configDir = path.dirname(configPath);
    const configFile = path.basename(configPath);

    const watchStream = Stream.async<Buffer | string | null>((emit) => {
      let watcher: fs.FSWatcher | null = null;
      try {
        watcher = fs.watch(configDir, { persistent: false }, (_eventType, filename) => {
          void emit.single(filename ?? null);
        });
      } catch (error) {
        console.warn('[openmux] Config watch failed:', error);
        return;
      }
      return Effect.sync(() => watcher?.close());
    }).pipe(
      Stream.filter((filename) => !filename || filename.toString() === configFile),
      Stream.debounce(Duration.millis(50)),
      Stream.tap(() => Effect.sync(() => reloadConfig()))
    );

    const stop = runStream(watchStream, { label: 'config-watch' });
    onCleanup(() => stop());
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
