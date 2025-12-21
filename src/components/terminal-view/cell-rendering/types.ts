export interface SelectedColumnRange {
  start: number
  end: number
}

export interface CellRenderingDeps {
  isCellSelected: (ptyId: string, x: number, y: number) => boolean
  getSelectedColumnsForRow: (ptyId: string, absoluteY: number, rowWidth: number) => SelectedColumnRange | null
  isSearchMatch: (ptyId: string, x: number, y: number) => boolean
  isCurrentMatch: (ptyId: string, x: number, y: number) => boolean
  getSelection: (ptyId: string) => { normalizedRange: unknown } | undefined
  getSearchMatchRanges: (
    ptyId: string,
    absoluteY: number
  ) => Array<{ startCol: number; endCol: number }> | null
}

export interface CellRenderingOptions {
  ptyId: string
  hasSelection: boolean
  hasSearch: boolean
  isAtBottom: boolean
  isFocused: boolean
  cursorX: number
  cursorY: number
  cursorVisible: boolean
  scrollbackLength: number
  viewportOffset: number
  currentMatch: { lineIndex: number; startCol: number; endCol: number } | null
}
