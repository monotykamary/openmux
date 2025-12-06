/**
 * Theme context for styling configuration
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { Theme } from '../core/types';
import { DEFAULT_THEME } from '../core/config';

const ThemeContext = createContext<Theme>(DEFAULT_THEME);

interface ThemeProviderProps {
  theme?: Partial<Theme>;
  children: ReactNode;
}

export function ThemeProvider({ theme, children }: ThemeProviderProps) {
  const mergedTheme: Theme = {
    pane: { ...DEFAULT_THEME.pane, ...theme?.pane },
    statusBar: { ...DEFAULT_THEME.statusBar, ...theme?.statusBar },
  };

  return (
    <ThemeContext.Provider value={mergedTheme}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
