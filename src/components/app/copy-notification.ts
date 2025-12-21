import { calculateLayoutDimensions } from '../aggregate'

interface PaneRect {
  x: number
  y: number
  width: number
  height: number
}

interface CopyNotificationLayoutParams {
  ptyId: string | null
  showAggregateView: boolean
  selectedPtyId: string | null
  width: number
  height: number
  panes: Array<{ ptyId?: string | null; rectangle?: PaneRect | null }>
}

export function getCopyNotificationRect(params: CopyNotificationLayoutParams): PaneRect | null {
  if (!params.ptyId) return null

  if (params.showAggregateView && params.selectedPtyId === params.ptyId) {
    const aggLayout = calculateLayoutDimensions({ width: params.width, height: params.height })
    return {
      x: aggLayout.listPaneWidth,
      y: 0,
      width: aggLayout.previewPaneWidth,
      height: aggLayout.contentHeight,
    }
  }

  return params.panes.find(p => p.ptyId === params.ptyId)?.rectangle ?? null
}
