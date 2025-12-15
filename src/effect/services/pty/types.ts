/**
 * Internal types for PTY service
 */

import type { IPty } from "../../../../zig-pty/src/index"
import type { TerminalState, UnifiedTerminalUpdate } from "../../../core/types"
import type { GhosttyEmulator } from "../../../terminal/ghostty-emulator"
import type { GraphicsPassthrough } from "../../../terminal/graphics-passthrough"
import type { TerminalQueryPassthrough } from "../../../terminal/terminal-query-passthrough"
import type { PtyId } from "../../types"

/**
 * Internal PTY session representation
 */
export interface InternalPtySession {
  id: PtyId
  pty: IPty
  emulator: GhosttyEmulator
  graphicsPassthrough: GraphicsPassthrough
  queryPassthrough: TerminalQueryPassthrough
  cols: number
  rows: number
  cwd: string
  shell: string
  subscribers: Set<(state: TerminalState) => void>
  scrollSubscribers: Set<() => void>
  /** Unified subscribers receive both terminal and scroll updates in one callback */
  unifiedSubscribers: Set<(update: UnifiedTerminalUpdate) => void>
  exitCallbacks: Set<(exitCode: number) => void>
  pendingNotify: boolean
  scrollState: {
    viewportOffset: number
  }
}
