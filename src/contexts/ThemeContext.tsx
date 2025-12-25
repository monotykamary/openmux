/**
 * Theme context for styling configuration
 */

import { createContext, useContext, type ParentProps } from 'solid-js';
import type { Theme } from '../core/types';
import { DEFAULT_THEME } from '../core/config';

const ThemeContext = createContext<Theme>(DEFAULT_THEME);

interface ThemeProviderProps extends ParentProps {
  theme?: Partial<Theme>;
}

export function ThemeProvider(props: ThemeProviderProps) {
  const mergedTheme: Theme = {
    pane: { ...DEFAULT_THEME.pane, ...props.theme?.pane },
    statusBar: { ...DEFAULT_THEME.statusBar, ...props.theme?.statusBar },
    commandPalette: { ...DEFAULT_THEME.commandPalette, ...props.theme?.commandPalette },
  };

  return (
    <ThemeContext.Provider value={mergedTheme}>
      {props.children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return theme;
}
