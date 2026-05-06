/**
 * CopyModeContext - manages vim-style copy mode for terminal panes
 *
 * Provides a virtual cursor for scrollback navigation and selection.
 * Refactored to use modular navigation, selection, and text extraction.
 */

import { createContext, useContext, createSignal, type ParentProps } from 'solid-js';
import type { TerminalState } from '../../core/types';
import { clampScrollOffset } from '../../core/scroll-utils';
import { copyToClipboard, getScrollbackLines } from '../../effect/bridge';
import { useTerminal } from '../TerminalContext';
import { useSelection } from '../SelectionContext';
import type { CopyModeContextValue, CopyModeState, CopyCursor, CopyVisualType } from './types';
import type { LineAccessor } from './text-utils';
import type { WordNavResult } from './navigation';
import {
  type ScrollMeta,
  clampCursor,
  calculateInitialCursor,
  moveCursorBy as navMoveCursorBy,
  calculateScrollForVisibility,
  getLineCellsAt,
  moveWordForward,
  moveWordBackward,
  moveWordEnd,
  moveWideWordForward,
  moveWideWordBackward,
  moveWideWordEnd,
  getLineStartX,
  getLineEndX,
} from './navigation';
import {
  recomputeSelection,
  toggleVisual as selToggleVisual,
  startSelection,
  clearSelection,
  selectLine,
  buildWordSelection,
  hasSelection,
  isCellSelectedSync,
  isCopyModeActive,
} from './selection';
import {
  extractBlockTextByChunks,
  extractRangeTextByChunks,
  prepareCopyText,
  TextExtractionError,
} from './text';
import { getLineAccessor, isWhitespaceChar, isWordChar } from './text-utils';
import { findSpanAtOrAfter } from './text-utils';

export type { CopyModeContextValue, CopyCursor, CopyVisualType } from './types';

const CopyModeContext = createContext<CopyModeContextValue | null>(null);

interface CopyModeProviderProps extends ParentProps {}

export function CopyModeProvider(props: CopyModeProviderProps) {
  const terminal = useTerminal();
  const selection = useSelection();
  const { getScrollState, setScrollOffset, getEmulatorSync, getTerminalStateSync } = terminal;

  const [state, setState] = createSignal<CopyModeState | null>(null);
  const [copyModeVersion, setCopyModeVersion] = createSignal(0);

  const notifyChange = () => setCopyModeVersion((v) => v + 1);
  const updateState = (next: CopyModeState | null) => {
    setState(next);
    notifyChange();
  };

  /** Get scroll metadata for the active PTY */
  const getScrollMeta = (
    ptyId: string,
    overrideGetTerminalState?: (ptyId: string) => TerminalState | null
  ): ScrollMeta => {
    const terminalState = overrideGetTerminalState?.(ptyId) ?? getTerminalStateSync(ptyId);
    const emulator = getEmulatorSync(ptyId);
    const scrollState = getScrollState(ptyId);
    const scrollbackLength = scrollState?.scrollbackLength ?? emulator?.getScrollbackLength() ?? 0;
    const rows = terminalState?.rows ?? 0;
    const cols = terminalState?.cols ?? 0;
    const viewportOffset = scrollState?.viewportOffset ?? 0;
    return { terminalState, emulator, scrollbackLength, rows, cols, viewportOffset };
  };

  /** Get active custom terminal state getter if any */
  const getActiveGetTerminalState = () => state()?.getTerminalState;

  /** Get scroll meta using active state's getter if available */
  const getActiveScrollMeta = (ptyId: string): ScrollMeta =>
    getScrollMeta(ptyId, getActiveGetTerminalState());

  /** Ensure cursor is visible by scrolling if needed */
  const ensureCursorVisible = (ptyId: string, cursor: CopyCursor) => {
    const meta = getActiveScrollMeta(ptyId);
    const scrollOffset = calculateScrollForVisibility(cursor, meta);
    if (scrollOffset !== null) {
      setScrollOffset(ptyId, clampScrollOffset(scrollOffset, meta.scrollbackLength));
    }
  };

  /** Move cursor to position with clamping and visibility */
  const moveCursorTo = (cursor: CopyCursor) => {
    const current = state();
    if (!current) return;
    const clamped = clampCursor(cursor, getActiveScrollMeta(current.ptyId));
    if (!clamped) return;
    const next = recomputeSelection(
      { ...current, cursor: clamped },
      getActiveScrollMeta(current.ptyId)
    );
    updateState(next);
    ensureCursorVisible(current.ptyId, clamped);
  };

  /** Get line accessor for word navigation */
  const getActiveLineAccessor = () => {
    const current = state();
    if (!current) return null;
    const meta = getActiveScrollMeta(current.ptyId);
    if (!meta.terminalState) return null;
    const maxAbsY = Math.max(0, meta.scrollbackLength + meta.rows - 1);
    return getLineAccessor(maxAbsY, (absY) => getLineCellsAt(absY, meta));
  };

  // Public API

  const enterCopyMode = (
    ptyId: string,
    overrideGetTerminalState?: (ptyId: string) => TerminalState | null
  ) => {
    const meta = getScrollMeta(ptyId, overrideGetTerminalState);
    if (!meta.terminalState || meta.rows <= 0 || meta.cols <= 0) return;

    const cursorY = meta.terminalState.cursor.y ?? 0;
    const cursorX = meta.terminalState.cursor.x ?? 0;
    const cursor = calculateInitialCursor(
      cursorX,
      cursorY,
      meta.viewportOffset,
      meta.scrollbackLength,
      meta.rows,
      meta.cols
    );

    updateState({
      ptyId,
      cursor,
      anchor: null,
      visualType: null,
      selectionRange: null,
      bounds: null,
      getTerminalState: overrideGetTerminalState,
    });
  };

  const exitCopyMode = () => updateState(null);
  const isActive = (ptyId?: string) => isCopyModeActive(state(), ptyId);
  const getActivePtyId = () => state()?.ptyId ?? null;
  const getCursor = (ptyId: string) => {
    const current = state();
    if (!current || current.ptyId !== ptyId) return null;
    return current.cursor;
  };

  const moveCursorBy = (dx: number, dy: number) => {
    const current = state();
    if (!current) return;
    moveCursorTo(navMoveCursorBy(current.cursor, dx, dy));
  };

  const moveToTop = () => moveCursorTo({ x: state()?.cursor.x ?? 0, absY: 0 });
  const moveToBottom = () => {
    const current = state();
    if (!current) return;
    const meta = getActiveScrollMeta(current.ptyId);
    if (meta.rows <= 0) return;
    const maxAbsY = Math.max(0, meta.scrollbackLength + meta.rows - 1);
    moveCursorTo({ x: current.cursor.x, absY: maxAbsY });
  };

  const moveToLineStart = () => {
    const current = state();
    if (!current) return;
    moveCursorTo({ x: 0, absY: current.cursor.absY });
  };

  const moveToLineEnd = () => {
    const current = state();
    if (!current) return;
    const meta = getActiveScrollMeta(current.ptyId);
    const line = getLineCellsAt(current.cursor.absY, meta);
    moveCursorTo({ x: getLineEndX(line), absY: current.cursor.absY });
  };

  const moveToLineFirstNonBlank = () => {
    const current = state();
    if (!current) return;
    const meta = getActiveScrollMeta(current.ptyId);
    const line = getLineCellsAt(current.cursor.absY, meta);
    moveCursorTo({
      x: getLineStartX(line, true),
      absY: current.cursor.absY,
    });
  };

  const getViewportRows = () => {
    const current = state();
    if (!current) return 0;
    return getActiveScrollMeta(current.ptyId).rows ?? 0;
  };

  // Word navigation - delegates to navigation module
  const execWordNav = (fn: (access: LineAccessor, cursor: CopyCursor) => WordNavResult | null) => {
    const current = state();
    if (!current) return;
    const access = getActiveLineAccessor();
    if (!access) return;
    const result = fn(access, current.cursor);
    if (result) moveCursorTo(result);
  };

  const wordNav = {
    forward: () => execWordNav(moveWordForward),
    backward: () => execWordNav(moveWordBackward),
    end: () => execWordNav(moveWordEnd),
    wideForward: () => execWordNav(moveWideWordForward),
    wideBackward: () => execWordNav(moveWideWordBackward),
    wideEnd: () => execWordNav(moveWideWordEnd),
  };

  // Selection - delegates to selection module
  const selApi = {
    toggle: (type: CopyVisualType) => {
      const current = state();
      if (!current) return;
      updateState(selToggleVisual(current, type, getActiveScrollMeta(current.ptyId)));
    },
    start: (type: CopyVisualType) => {
      const current = state();
      if (!current) return;
      updateState(startSelection(current, type, getActiveScrollMeta(current.ptyId)));
    },
    clear: () => {
      const current = state();
      if (!current) return;
      updateState(clearSelection(current));
    },
    selectLine: () => {
      const current = state();
      if (!current) return;
      updateState(selectLine(current, getActiveScrollMeta(current.ptyId)));
    },
    selectWord: (mode: 'inner' | 'around') => {
      const current = state();
      if (!current) return;
      const access = getActiveLineAccessor();
      if (!access) return;
      const word = findSpanAtOrAfter(access, current.cursor.absY, current.cursor.x, isWordChar);
      if (!word) return;
      const result = buildWordSelection(word, mode, isWhitespaceChar);
      if (!result) return;
      const next = recomputeSelection(
        { ...current, cursor: result.cursor, anchor: result.anchor, visualType: 'char' },
        getActiveScrollMeta(current.ptyId)
      );
      updateState(next);
      ensureCursorVisible(current.ptyId, result.cursor);
    },
  };

  // Copy - delegates to text module
  const copySelection = async () => {
    const current = state();
    if (!current) return;
    const meta = getActiveScrollMeta(current.ptyId);
    if (!meta.terminalState) return;

    await selection.beginCopy(current.ptyId);

    const fetchScrollbackChunk = (startOffset: number, count: number) =>
      getScrollbackLines(current.ptyId, startOffset, count);
    const getLiveLine = (absY: number) => {
      const liveY = absY - meta.scrollbackLength;
      return meta.terminalState?.cells[liveY] ?? null;
    };

    let text: string;

    if (current.visualType === 'block' && current.anchor) {
      const result = await extractBlockTextByChunks({
        anchor: current.anchor,
        cursor: current.cursor,
        scrollbackLength: meta.scrollbackLength,
        fetchScrollbackLines: fetchScrollbackChunk,
        getLiveLine,
      });
      if (result instanceof TextExtractionError) {
        console.warn('Text extraction failed:', result.message);
        selection.notifyCopyError(current.ptyId);
        return;
      }
      text = result;
    } else {
      const range = current.selectionRange ?? {
        startX: 0,
        startY: current.cursor.absY,
        endX: Math.max(1, meta.cols),
        endY: current.cursor.absY,
        focusAtEnd: true as const,
      };
      const result = await extractRangeTextByChunks({
        range,
        scrollbackLength: meta.scrollbackLength,
        fetchScrollbackLines: fetchScrollbackChunk,
        getLiveLine,
      });
      if (result instanceof TextExtractionError) {
        console.warn('Text extraction failed:', result.message);
        selection.notifyCopyError(current.ptyId);
        return;
      }
      text = result;
    }

    const copyResult = prepareCopyText(text);
    if (!copyResult) {
      selection.clearCopyNotification();
      return;
    }

    const didCopy = await copyToClipboard(copyResult.text);
    if (!didCopy) {
      selection.notifyCopyError(current.ptyId);
      return;
    }

    selection.notifyCopy(copyResult.length, current.ptyId);
  };

  const value: CopyModeContextValue = {
    enterCopyMode,
    exitCopyMode,
    isActive,
    getActivePtyId,
    getCursor,
    moveCursorBy,
    moveCursorTo,
    moveToTop,
    moveToBottom,
    moveToLineStart,
    moveToLineEnd,
    moveToLineFirstNonBlank,
    getViewportRows,
    moveWordForward: wordNav.forward,
    moveWordBackward: wordNav.backward,
    moveWordEnd: wordNav.end,
    moveWideWordForward: wordNav.wideForward,
    moveWideWordBackward: wordNav.wideBackward,
    moveWideWordEnd: wordNav.wideEnd,
    toggleVisual: selApi.toggle,
    startSelection: selApi.start,
    selectWord: selApi.selectWord,
    selectLine: selApi.selectLine,
    copySelection,
    clearSelection: selApi.clear,
    isCellSelected: (ptyId, x, absY) => isCellSelectedSync(state(), ptyId, x, absY),
    hasSelection: (ptyId) => hasSelection(state(), ptyId),
    get copyModeVersion() {
      return copyModeVersion();
    },
  };

  return <CopyModeContext.Provider value={value}>{props.children}</CopyModeContext.Provider>;
}

export function useCopyMode(): CopyModeContextValue {
  const context = useContext(CopyModeContext);
  if (!context) {
    throw new Error('useCopyMode must be used within CopyModeProvider');
  }
  return context;
}
