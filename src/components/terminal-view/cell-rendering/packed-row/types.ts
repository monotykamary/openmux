import type { RGBA } from '@opentui/core'

const PACKED_CELL_U32_STRIDE = 12
export const PACKED_CELL_BYTE_STRIDE = PACKED_CELL_U32_STRIDE * 4
export const SPACE_CODEPOINT = 32
export const PACKED_CELL_STRIDE_U32 = PACKED_CELL_U32_STRIDE

export interface PackedRowBuffer {
  buffer: ArrayBuffer
  floats: Float32Array
  uints: Uint32Array
  capacity: number
  overlayX: Int32Array
  overlayCodepoint: Uint32Array
  overlayAttributes: Uint8Array
  overlayFg: Array<RGBA | null>
  overlayBg: Array<RGBA | null>
  overlayCount: number
}

export interface PackedRowBatchBuffer {
  buffer: ArrayBuffer
  bytes: Uint8Array
  floats: Float32Array
  uints: Uint32Array
  capacityCols: number
  capacityRows: number
  overlayX: Int32Array
  overlayY: Int32Array
  overlayCodepoint: Uint32Array
  overlayAttributes: Uint8Array
  overlayFg: Array<RGBA | null>
  overlayBg: Array<RGBA | null>
  overlayCount: number
}

export interface RowTextCacheEntry {
  text: string
  fg: RGBA
  bg: RGBA
}

export type RowTextCache = Array<RowTextCacheEntry | null>

export interface RowRenderCache {
  packedRow: PackedRowBuffer
  rowText: RowTextCache
}
