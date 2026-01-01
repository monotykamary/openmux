/**
 * Internal types for PTY service
 */

import type { IPty } from "../../../../native/zig-pty/ts/index"
import type { TerminalState, UnifiedTerminalUpdate } from "../../../core/types"
import type { ITerminalEmulator } from "../../../terminal/emulator-interface"
import type { TerminalQueryPassthrough } from "../../../terminal/terminal-query-passthrough"
import type { PtyId } from "../../types"

/**
 * Internal PTY session representation
 */
export interface InternalPtySession {
  id: PtyId
  pty: IPty
  emulator: ITerminalEmulator
  queryPassthrough: TerminalQueryPassthrough
  kittyRelayDispose?: () => void
  cols: number
  rows: number
  pixelWidth: number
  pixelHeight: number
  cellWidth: number
  cellHeight: number
  cwd: string
  shell: string
  closing: boolean
  subscribers: Set<(state: TerminalState) => void>
  scrollSubscribers: Set<() => void>
  /** Unified subscribers receive both terminal and scroll updates in one callback */
  unifiedSubscribers: Set<(update: UnifiedTerminalUpdate) => void>
  exitCallbacks: Set<(exitCode: number) => void>
  /** Title change subscribers for this specific PTY */
  titleSubscribers: Set<(title: string) => void>
  /** Last command captured from shell hooks (OSC 777) */
  lastCommand: string | null
  pendingNotify: boolean
  scrollState: {
    viewportOffset: number
    /** Track last scrollback length to detect when new content is added */
    lastScrollbackLength: number
  }
}
