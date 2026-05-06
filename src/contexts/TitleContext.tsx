/**
 * Title Context - Manages pane titles separately from the layout store
 *
 * This prevents title updates from triggering full layout re-renders,
 * which was causing screen flash issues with web workers.
 */

import { createContext, useContext, createSignal, type ParentProps, type Accessor } from 'solid-js';

export interface TitleContextValue {
  /** Get the title for a pane */
  getTitle: (paneId: string) => string | undefined;
  /** Set the title for a pane (does not trigger layout re-renders) */
  setTitle: (paneId: string, title: string) => void;
  /** Clear auto title (preserves manual override if set) */
  clearAutoTitle: (paneId: string) => void;
  /** Set a manual title override for a pane */
  setManualTitle: (paneId: string, title: string) => void;
  /** Clear manual title override */
  clearManualTitle: (paneId: string) => void;
  /** Clear title when pane is destroyed */
  clearTitle: (paneId: string) => void;
  /** Version signal - increment triggers title re-reads */
  titleVersion: Accessor<number>;
}

const TitleContext = createContext<TitleContextValue | null>(null);

export function TitleProvider(props: ParentProps) {
  const value = createTitleStore();

  return <TitleContext.Provider value={value}>{props.children}</TitleContext.Provider>;
}

export function createTitleStore(): TitleContextValue {
  // Plain Map for titles - not reactive
  const titles = new Map<string, string>();
  const manualTitles = new Map<string, string>();

  // Version signal to trigger re-reads when titles change
  const [titleVersion, setTitleVersion] = createSignal(0);

  const getTitle = (paneId: string): string | undefined => {
    return manualTitles.get(paneId) ?? titles.get(paneId);
  };

  const setTitle = (paneId: string, title: string) => {
    const current = titles.get(paneId);
    if (current !== title) {
      titles.set(paneId, title);
      if (!manualTitles.has(paneId)) {
        // Increment version to trigger re-reads in components
        setTitleVersion((v) => v + 1);
      }
    }
  };

  const clearAutoTitle = (paneId: string) => {
    const hadAuto = titles.delete(paneId);
    if (hadAuto && !manualTitles.has(paneId)) {
      setTitleVersion((v) => v + 1);
    }
  };

  const setManualTitle = (paneId: string, title: string) => {
    const current = manualTitles.get(paneId);
    if (current !== title) {
      manualTitles.set(paneId, title);
      setTitleVersion((v) => v + 1);
    }
  };

  const clearManualTitle = (paneId: string) => {
    if (manualTitles.has(paneId)) {
      manualTitles.delete(paneId);
      setTitleVersion((v) => v + 1);
    }
  };

  const clearTitle = (paneId: string) => {
    const hadTitle = titles.delete(paneId);
    const hadManual = manualTitles.delete(paneId);
    if (hadTitle || hadManual) {
      setTitleVersion((v) => v + 1);
    }
  };

  return {
    getTitle,
    setTitle,
    clearAutoTitle,
    setManualTitle,
    clearManualTitle,
    clearTitle,
    titleVersion,
  };
}

export function useTitle(): TitleContextValue {
  const context = useContext(TitleContext);
  if (!context) {
    throw new Error('useTitle must be used within TitleProvider');
  }
  return context;
}
