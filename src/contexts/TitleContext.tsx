/**
 * Title Context - Manages pane titles separately from the layout store
 *
 * This prevents title updates from triggering full layout re-renders,
 * which was causing screen flash issues with web workers.
 */

import {
  createContext,
  useContext,
  createSignal,
  type ParentProps,
  type Accessor,
} from 'solid-js';

interface TitleContextValue {
  /** Get the title for a pane */
  getTitle: (paneId: string) => string | undefined;
  /** Set the title for a pane (does not trigger layout re-renders) */
  setTitle: (paneId: string, title: string) => void;
  /** Clear title when pane is destroyed */
  clearTitle: (paneId: string) => void;
  /** Version signal - increment triggers title re-reads */
  titleVersion: Accessor<number>;
}

const TitleContext = createContext<TitleContextValue | null>(null);

export function TitleProvider(props: ParentProps) {
  // Plain Map for titles - not reactive
  const titles = new Map<string, string>();

  // Version signal to trigger re-reads when titles change
  const [titleVersion, setTitleVersion] = createSignal(0);

  const getTitle = (paneId: string): string | undefined => {
    return titles.get(paneId);
  };

  const setTitle = (paneId: string, title: string) => {
    const current = titles.get(paneId);
    if (current !== title) {
      titles.set(paneId, title);
      // Increment version to trigger re-reads in components
      setTitleVersion(v => v + 1);
    }
  };

  const clearTitle = (paneId: string) => {
    if (titles.has(paneId)) {
      titles.delete(paneId);
      setTitleVersion(v => v + 1);
    }
  };

  const value: TitleContextValue = {
    getTitle,
    setTitle,
    clearTitle,
    titleVersion,
  };

  return (
    <TitleContext.Provider value={value}>
      {props.children}
    </TitleContext.Provider>
  );
}

export function useTitle(): TitleContextValue {
  const context = useContext(TitleContext);
  if (!context) {
    throw new Error('useTitle must be used within TitleProvider');
  }
  return context;
}
