/**
 * Configuration for openmux layout and styling
 */

import type { AutomaticScheme, Padding, Theme } from './types';

export interface BSPConfig {
  /** Gap between panes in terminal cells */
  windowGap: number;

  /** Outer padding around all panes */
  outerPadding: Padding;

  /** Border width (typically 1) */
  borderWidth: number;

  /** Split behavior */
  automaticScheme: AutomaticScheme;
  defaultSplitRatio: number;

  /** Minimum pane sizes */
  minPaneWidth: number;
  minPaneHeight: number;

  /** Prefix key timeout in milliseconds */
  prefixTimeout: number;

  /** Default shell */
  defaultShell: string;
}

export const DEFAULT_CONFIG: BSPConfig = {
  windowGap: 0,
  outerPadding: { top: 0, right: 0, bottom: 0, left: 0 },
  borderWidth: 1,
  automaticScheme: 'spiral',
  defaultSplitRatio: 0.5,
  minPaneWidth: 10,
  minPaneHeight: 5,
  prefixTimeout: 2000,
  defaultShell: process.env.SHELL ?? '/bin/bash',
};

export const DEFAULT_THEME: Theme = {
  pane: {
    borderColor: '#444444',
    focusedBorderColor: '#00AAFF',
    urgentBorderColor: '#FF5500',
    borderStyle: 'rounded',
    innerGap: 1,
    outerGap: 1,
    titleColor: '#888888',
    focusedTitleColor: '#FFFFFF',
  },
  statusBar: {
    backgroundColor: '#1a1a1a',
    foregroundColor: '#CCCCCC',
    activeTabColor: '#00AAFF',
    inactiveTabColor: '#666666',
  },
};

/** Resize step amount (as ratio) */
export const RESIZE_STEP = 0.05;

/** Prefix key (used with Ctrl) */
export const PREFIX_KEY = 'b';
