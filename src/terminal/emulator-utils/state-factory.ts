/**
 * State Factory - creates default terminal states
 */
import type { TerminalCell, TerminalState, TerminalScrollState, DirtyTerminalUpdate } from '../../core/types'
import type { TerminalModes } from '../emulator-interface'
import type { TerminalColors } from '../terminal-colors'
import { extractRgb } from '../terminal-colors'

/**
 * Create default terminal modes
 */
export function createDefaultModes(): TerminalModes {
  return {
    mouseTracking: false,
    cursorKeyMode: 'normal',
    alternateScreen: false,
    inBandResize: false,
  }
}

/**
 * Create default scroll state
 */
export function createDefaultScrollState(): TerminalScrollState {
  return {
    viewportOffset: 0,
    scrollbackLength: 0,
    isAtBottom: true,
  }
}

/**
 * Create empty terminal state with given dimensions and colors
 */
export function createEmptyTerminalState(
  cols: number,
  rows: number,
  colors: TerminalColors,
  modes: TerminalModes
): TerminalState {
  const fg = extractRgb(colors.foreground)
  const bg = extractRgb(colors.background)

  const emptyCells: TerminalCell[][] = []
  for (let y = 0; y < rows; y++) {
    const row: TerminalCell[] = []
    for (let x = 0; x < cols; x++) {
      row.push({
        char: ' ',
        fg,
        bg,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        inverse: false,
        blink: false,
        dim: false,
        width: 1,
      })
    }
    emptyCells.push(row)
  }

  return {
    cols,
    rows,
    cells: emptyCells,
    cursor: { x: 0, y: 0, visible: true, style: 'block' },
    alternateScreen: modes.alternateScreen,
    mouseTracking: modes.mouseTracking,
    cursorKeyMode: modes.cursorKeyMode,
  }
}

type CursorStyle = 'block' | 'underline' | 'bar'

export interface TerminalCursor {
  x: number
  y: number
  visible: boolean
  style?: CursorStyle
}

/**
 * Create empty dirty update
 */
export function createEmptyDirtyUpdate(
  cols: number,
  rows: number,
  scrollState: TerminalScrollState,
  modes: TerminalModes,
  cursor?: TerminalCursor
): DirtyTerminalUpdate {
  return {
    dirtyRows: new Map(),
    cursor: cursor ?? { x: 0, y: 0, visible: true, style: 'block' as CursorStyle },
    scrollState,
    cols,
    rows,
    isFull: false,
    alternateScreen: modes.alternateScreen,
    mouseTracking: modes.mouseTracking,
    cursorKeyMode: modes.cursorKeyMode,
    inBandResize: modes.inBandResize,
  }
}
