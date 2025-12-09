/**
 * Configuration for openmux layout and styling
 */

import type { LayoutMode, Padding, Theme } from './types';

export interface LayoutConfig {
  /** Gap between panes in terminal cells */
  windowGap: number;

  /** Outer padding around all panes */
  outerPadding: Padding;

  /** Border width (typically 1) */
  borderWidth: number;

  /** Default layout mode for new workspaces */
  defaultLayoutMode: LayoutMode;
  defaultSplitRatio: number;

  /** Minimum pane sizes */
  minPaneWidth: number;
  minPaneHeight: number;

  /** Prefix key timeout in milliseconds */
  prefixTimeout: number;

  /** Default shell */
  defaultShell: string;

  /** Session storage directory path */
  sessionStoragePath: string;

  /** Auto-save interval in milliseconds (0 to disable) */
  autoSaveInterval: number;
}

/** Get the session storage path (platform-aware) */
function getSessionStoragePath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return `${home}/.config/openmux/sessions`;
}

export const DEFAULT_CONFIG: LayoutConfig = {
  windowGap: 0,
  outerPadding: { top: 0, right: 0, bottom: 0, left: 0 },
  borderWidth: 1,
  defaultLayoutMode: 'vertical',
  defaultSplitRatio: 0.5,
  minPaneWidth: 10,
  minPaneHeight: 5,
  prefixTimeout: 2000,
  defaultShell: process.env.SHELL ?? '/bin/bash',
  sessionStoragePath: getSessionStoragePath(),
  autoSaveInterval: 30000, // 30 seconds
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

/** Prefix key (used with Ctrl) */
export const PREFIX_KEY = 'b';
