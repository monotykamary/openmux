/**
 * PTY data handler factory - creates the data processing pipeline (errore version)
 * Handles sync mode parsing and query passthrough.
 */
import type { SyncModeParser } from '../../../terminal/sync-mode-parser';
import type { InternalPtySession } from './types';
import { deferMacrotask } from '../../../core/scheduling';
import {
  getPriorityConfig,
  resolvePtyPriority,
  type PtyPriority,
} from '../../../terminal/pty-priority';
import { getFocusedPtyId } from '../../../terminal/focused-pty-registry';
import { isPtyVisible } from '../../../terminal/visible-pty-registry';
import { tracePtyChunk, tracePtyEvent } from '../../../terminal/pty-trace';
import * as errore from 'errore';
import { DataHandlerError } from '../../errors';

/** Base64 decode error for clipboard operations */
class ClipboardDecodeError extends errore.createTaggedError({
  name: 'ClipboardDecodeError',
  message: 'Clipboard base64 decode failed: $reason',
}) {}

interface DataHandlerOptions {
  session: InternalPtySession;
  syncParser: SyncModeParser;
  commandParser?: { processData: (data: string) => void | Promise<void> };
  syncTimeoutMs?: number;
  /** Injected clipboard writer — avoids importing the bridge singleton (breaks circular dep) */
  copyToClipboard: (text: string) => Promise<boolean>;
  /**
   * Returns the current priority for this PTY.
   * Defaults to registry-based resolution (focused-pty-registry + visible-pty-registry).
   * Override for testing to avoid singleton state pollution.
   */
  getPriority?: () => PtyPriority;
}

/** Maximum size for the raw-buffer used by hidden PTYs (4 MiB). */
const RAW_BUFFER_MAX_SIZE = 4 * 1024 * 1024;

interface DataHandlerState {
  pendingSegments: string[];
  syncTimeout: ReturnType<typeof setTimeout> | null;
  syncLikelyPiFullRedraw: boolean;
  pendingResponses: { fence: number; responses: string[] }[];
  segmentCounter: number;
  processedCounter: number;
  /**
   * Raw data buffer for background/hidden PTYs.
   * Uses an array of chunks instead of string concatenation to avoid
   * O(n²) copying as the buffer grows under heavy output (find / -ls).
   */
  rawChunks: string[];
  rawBufferLength: number;
}

const ESC = '\x1b';
const APC_C1 = '\x9f';
const FOCUS_TRACKING_ENABLE = '\x1b[?1004h';
const FOCUS_TRACKING_DISABLE = '\x1b[?1004l';
const FOCUS_TRACKING_ENABLE_C1 = '\x9b?1004h';
const FOCUS_TRACKING_DISABLE_C1 = '\x9b?1004l';
const FOCUS_IN_SEQUENCE = '\x1b[I';
const FOCUS_OUT_SEQUENCE = '\x1b[O';
const FOCUS_TRACKING_PROBE_LEN = 16;
const SYNC_SET = '\x1b[?2026h';
const SYNC_RESET = '\x1b[?2026l';
const SYNC_SET_C1 = '\x9b?2026h';
const SYNC_RESET_C1 = '\x9b?2026l';
const SCROLLBACK_CLEAR_REGEX = /\x1b\[([0-9;]*)J/g;
const SCROLLBACK_CLEAR_C1_REGEX = /\x9b([0-9;]*)J/g;

// Clear-screen suppression after resize (prevents shell SIGWINCH clears from destroying reflowed content)
const CLEAR_SUPPRESSION_WINDOW_MS = 50;
const CLEAR_SCREEN_REGEX = /\x1b\[2J/g;
const CLEAR_SCREEN_C1_REGEX = /\x9b2J/g;

// Pi full redraws reach data-handler after sync-mode-parser has already stripped
// CSI ? 2026 h/l. Normalize the post-sync payload instead of looking for sync markers.
const CURSOR_HOME_SEQUENCE = '\x1b[H';
const ERASE_TO_END_OF_SCREEN = '\x1b[J';
const CLEAR_SCROLLBACK = '\x1b[3J';
// CSI 3J (scrollback clear) is optional — most pi full-redraw frames use
// CSI 2J + CSI H without CSI 3J. Both forms need normalization to prevent
// ghostty's scrollClear from pushing old screen content into scrollback.
// Matches pi's full-redraw prefix (CSI 2J + CSI H + optional CSI 3J) at any
// position within a sync-wrapped segment. The ^-anchored version only matched
// when CSI 2J was at the segment start, but pi's fullRender prepends Kitty
// image delete sequences (\x1b_Ga=d,...\x1b\\) before CSI 2J, causing the
// regex to miss those frames. Since all segments from the sync parser are
// already validated as sync-wrapped (pi TUI output), matching anywhere is safe —
// it will not accidentally normalize CSI 2J from user `clear` commands (those
// are non-sync and released as separate segments by the parser).
const PI_FULL_REDRAW_PREFIX_REGEX =
  /(?:\x1b\[2J|\x9b2J)(?:\x1b\[(?:H|1;1H)|\x9b(?:H|1;1H))(?:\x1b\[3J|\x9b3J)?/;
const RAW_PI_SYNC_FULL_REDRAW_START_REGEX =
  /\x1b\[\?2026h(?:\x1b\[2J|\x9b2J)(?:\x1b\[(?:H|1;1H)|\x9b(?:H|1;1H))(?:\x1b\[3J|\x9b3J)?/;
const PI_SYNC_TIMEOUT_MS = 750;

/** PTY interface with optional foreground process name access */
interface PtyWithForegroundProcess {
  getForegroundProcessName?: () => string | null;
}

function normalizeProcessName(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const base = trimmed.split(/[\\/]/).pop() ?? trimmed;
  const normalized = base.replace(/^-+/, '').toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function resolveFocusTrackingOwnerProcess(session: InternalPtySession): string | null {
  const pty = session.pty as PtyWithForegroundProcess;
  if (typeof pty.getForegroundProcessName !== 'function') return null;
  const result = errore.try<string, DataHandlerError>({
    try: () => normalizeProcessName(pty.getForegroundProcessName!()) ?? '',
    catch: (cause: unknown) =>
      new DataHandlerError({
        operation: 'resolve-focus-tracking',
        reason: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });
  if (result instanceof DataHandlerError) return null;
  return result || null;
}

function hasScrollbackEraseSequence(text: string, regex: RegExp): boolean {
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const params = match[1] ?? '';
    const parts = params.split(';').filter(Boolean);
    if (parts.includes('3')) return true;
  }
  return false;
}

/**
 * Check if we should suppress clear-screen sequences (CSI 2 J) for this session.
 * Returns true if we're within the suppression window after a resize.
 */
function shouldSuppressClearScreen(session: InternalPtySession): boolean {
  if (session.lastResizeTime === 0) return false;
  const elapsed = Date.now() - session.lastResizeTime;
  return elapsed < CLEAR_SUPPRESSION_WINDOW_MS;
}

/** Count non-overlapping occurrences of a substring. */
function countOccurrences(text: string, substr: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(substr, pos)) !== -1) {
    count++;
    pos += substr.length;
  }
  return count;
}

/**
 * Strip all complete sync-mode frames from a string, keeping only
 * the non-sync data (query responses, partial output) between frames.
 * Used by replayRawBufferFull to skip intermediate animation frames
 * while preserving non-sync data that must be processed.
 */
function stripSyncFrames(text: string): string {
  let result = '';
  let pos = 0;
  while (pos < text.length) {
    // Find next sync-set (7-bit or C1)
    const idx7 = text.indexOf(SYNC_SET, pos);
    const idx8 = text.indexOf(SYNC_SET_C1, pos);
    let syncIdx: number;
    let syncLen: number;
    if (idx7 !== -1 && idx8 !== -1) {
      syncIdx = Math.min(idx7, idx8);
      syncLen = idx7 < idx8 ? SYNC_SET.length : SYNC_SET_C1.length;
    } else if (idx7 !== -1) {
      syncIdx = idx7;
      syncLen = SYNC_SET.length;
    } else if (idx8 !== -1) {
      syncIdx = idx8;
      syncLen = SYNC_SET_C1.length;
    } else {
      // No more sync frames — emit the rest
      result += text.slice(pos);
      break;
    }

    // Emit non-sync data before this sync frame
    if (syncIdx > pos) {
      result += text.slice(pos, syncIdx);
    }

    // Find matching sync-reset (either 7-bit or C1, independent of the set format)
    const afterSync = text.slice(syncIdx + syncLen);
    const resetIdx7 = afterSync.indexOf(SYNC_RESET);
    const resetIdx8 = afterSync.indexOf(SYNC_RESET_C1);
    const resetOffset =
      resetIdx7 !== -1 && resetIdx8 !== -1
        ? Math.min(resetIdx7, resetIdx8)
        : resetIdx7 !== -1
          ? resetIdx7
          : resetIdx8;

    if (resetOffset !== -1) {
      // Skip the entire sync frame (set + content + reset)
      // Use the actual length of the reset sequence found
      const resetLen = resetOffset === resetIdx7 ? SYNC_RESET.length : SYNC_RESET_C1.length;
      pos = syncIdx + syncLen + resetOffset + resetLen;
    } else {
      // Incomplete sync frame — emit sync-set and everything after
      // (the sync parser will handle the buffering)
      result += text.slice(syncIdx);
      break;
    }
  }
  return result;
}

/**
 * Replace pi's destructive full-redraw prefix with a non-scrolling equivalent.
 *
 * sync-mode-parser strips CSI ? 2026 h/l before ready segments reach data-handler, so
 * the real payload we see here starts with CSI 2 J, home, CSI 3 J, then the new frame.
 *
 * The original sequence (CSI 2J + CSI H + CSI 3J) would clear the screen, push visible
 * content to scrollback (via ghostty's scrollClear heuristic on the primary screen at
 * a prompt), then destroy all scrollback. Even dropping CSI 3J, keeping CSI 2J still
 * pushes the entire visible conversation into scrollback, causing duplicate content.
 *
 * Pi's full redraw is a replacement, not a scroll. The new frame (rendered by OpenTUI
 * with explicit cursor positioning) overwrites every visible row without triggering
 * linefeed-based scrolling. The original CSI 2J is replaced with CSI H + CSI J (cursor
 * home then erase-to-end-of-screen): this blanks every visible cell in-place without
 * triggering ghostty's scrollClear heuristic or pushing anything into scrollback.
 *
 * CSI 3J (clear scrollback) is INCLUDED in the replacement. Without it, scrollback
 * accumulates across full-redraw frames because the normalization strips CSI 3J from
 * pi's original prefix. Pi's differential rendering uses relative cursor positioning
 * that depends on its internal viewportTop matching the emulator's actual scroll
 * position. Accumulated scrollback causes these to diverge, resulting in permanent
 * row-position artifacts (content written to wrong rows by differential renders).
 *
 * Including CSI 3J keeps both the anti-scrollClear benefit and the scrollback-reset
 * guarantee, at the cost of clearing the user's scrollback history on each full
 * redraw. This matches pi's original intent (CSI 3J was there to clear scrollback)
 * while avoiding the scrollClear push.
 *
 * Sync-mode-parser's atomic delivery guarantees no intermediate stale state is
 * rendered, so there is no flicker.
 *
 * @internal Exported for testing
 */
export function normalizePiFullRedrawSegment(segment: string, _terminalRows: number): string {
  const match = segment.match(PI_FULL_REDRAW_PREFIX_REGEX);
  if (!match) return segment;

  // Include CSI 3J (clear scrollback) in the replacement so that
  // accumulated scrollback is reset on each full redraw. Without this,
  // scrollback accumulates across frames because the normalization strips
  // the CSI 3J from pi's original CSI 2J + CSI H + CSI 3J prefix.
  // Accumulated scrollback causes pi's viewportTop tracking (used for
  // differential rendering's relative cursor positioning) to diverge
  // from the emulator's actual scroll position, leading to permanent
  // row-position artifacts during bash tool calls.
  //
  // The regex matches CSI 2J + CSI H + optional CSI 3J at any position
  // in the segment (pi may prepend Kitty image delete sequences before
  // CSI 2J in its fullRender). Preserve any prefix before the match and
  // replace only the CSI 2J + CSI H + optional CSI 3J portion.
  const prefix = segment.slice(0, match.index!);
  const frame = segment.slice(match.index! + match[0].length);
  return `${prefix}${CURSOR_HOME_SEQUENCE}${ERASE_TO_END_OF_SCREEN}${CLEAR_SCROLLBACK}${frame}`;
}

/**
 * Filter out clear-screen sequences (CSI 2 J) from data.
 * Used during the suppression window after resize to prevent shell SIGWINCH
 * from clearing the reflowed scrollback content.
 * @internal Exported for testing
 */
export function suppressClearScreenSequences(data: string): string {
  // Replace CSI 2 J with nothing (drop the sequence)
  return data.replace(CLEAR_SCREEN_REGEX, '').replace(CLEAR_SCREEN_C1_REGEX, '');
}

/**
 * Detect and process OSC 52 clipboard write responses from emulator.
 * These are responses with format: "\x1B]52;CLIPBOARD;c:<base64data>\x07"
 * Returns an array of PTY responses (non-clipboard responses) and processes clipboard data separately.
 */
function processClipboardResponses(
  responses: string[],
  ptyId: string,
  clipboardWriter: (text: string) => Promise<boolean>
): string[] {
  const ptyResponses: string[] = [];
  const CLIPBOARD_PREFIX = '\x1B]52;CLIPBOARD;c:';
  const BEL = '\x07';

  for (const response of responses) {
    // Debug: Log all responses to see what's coming through
    tracePtyEvent('clipboard-response-raw', {
      ptyId,
      responsePreview: response.slice(0, 50),
      responseLength: response.length,
      isClipboard: response.startsWith(CLIPBOARD_PREFIX),
    });

    if (response.startsWith(CLIPBOARD_PREFIX) && response.endsWith(BEL)) {
      // Extract base64 data
      const base64Data = response.slice(CLIPBOARD_PREFIX.length, -BEL.length);
      if (base64Data.length === 0) continue;

      // Decode base64 and copy to clipboard
      const decoded = errore.try({
        try: () => Buffer.from(base64Data, 'base64').toString('utf-8'),
        catch: (err: unknown) =>
          new ClipboardDecodeError({
            reason: err instanceof Error ? err.message : String(err),
          }),
      });
      if (decoded instanceof Error) {
        tracePtyEvent('clipboard-decode-error', {
          ptyId,
          error: decoded.message,
        });
        continue;
      }
      if (decoded.length === 0) continue;

      clipboardWriter(decoded).catch((err: unknown) => {
        tracePtyEvent('clipboard-copy-error', {
          ptyId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      tracePtyEvent('clipboard-copy', {
        ptyId,
        charCount: decoded.length,
      });
      continue;
    }

    // Not a clipboard response, pass through to PTY
    ptyResponses.push(response);
  }

  return ptyResponses;
}

/**
 * Creates the PTY data handler that processes incoming data
 * Returns the data handler function and cleanup function
 */
export function createDataHandler(options: DataHandlerOptions) {
  const { session, syncParser, commandParser, syncTimeoutMs = 100 } = options;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let lastDrainTime = 0;

  const defaultGetPriority = () => {
    const visible = isPtyVisible(session.id);
    const focused = getFocusedPtyId();
    if (!visible && focused === null) return 'focused' as PtyPriority;
    return resolvePtyPriority(session.id, focused, visible);
  };
  const getPriority = options.getPriority ?? defaultGetPriority;

  const state: DataHandlerState = {
    pendingSegments: [],
    syncTimeout: null,
    syncLikelyPiFullRedraw: false,
    pendingResponses: [],
    segmentCounter: 0,
    processedCounter: 0,
    rawChunks: [],
    rawBufferLength: 0,
  };
  let kittyProbeBuffer = '';
  let focusProbeBuffer = '';

  const analyzeKitty = (data: string): { hasKittyApc: boolean; hasKittyQuery: boolean } => {
    if (data.length === 0) return { hasKittyApc: false, hasKittyQuery: false };
    const combined = kittyProbeBuffer + data;
    kittyProbeBuffer = combined.slice(-256);
    const hasKittyApc = combined.includes(`${ESC}_G`) || combined.includes(`${APC_C1}G`);
    const hasKittyQuery = hasKittyApc && combined.includes('a=q');
    return { hasKittyApc, hasKittyQuery };
  };

  const updateFocusTracking = (data: string) => {
    if (data.length === 0) return;
    const combined = focusProbeBuffer + data;

    const lastEnable = Math.max(
      combined.lastIndexOf(FOCUS_TRACKING_ENABLE),
      combined.lastIndexOf(FOCUS_TRACKING_ENABLE_C1)
    );
    const lastDisable = Math.max(
      combined.lastIndexOf(FOCUS_TRACKING_DISABLE),
      combined.lastIndexOf(FOCUS_TRACKING_DISABLE_C1)
    );

    if (lastEnable !== -1 || lastDisable !== -1) {
      const wasEnabled = session.focusTrackingEnabled;
      session.focusTrackingEnabled = lastEnable > lastDisable;

      if (session.focusTrackingEnabled) {
        const ownerProcess = resolveFocusTrackingOwnerProcess(session);
        if (ownerProcess) {
          session.focusTrackingOwnerProcess = ownerProcess;
        } else if (!wasEnabled) {
          session.focusTrackingOwnerProcess = null;
        }
      } else {
        session.focusTrackingOwnerProcess = null;
      }

      if (session.focusTrackingEnabled !== wasEnabled) {
        tracePtyEvent('pty-focus-tracking', {
          ptyId: session.id,
          enabled: session.focusTrackingEnabled,
          ownerProcess: session.focusTrackingOwnerProcess,
        });
      }

      if (!wasEnabled && session.focusTrackingEnabled) {
        tracePtyEvent('pty-focus-sync', {
          ptyId: session.id,
          focused: session.focusState,
        });
        session.pty.write(session.focusState ? FOCUS_IN_SEQUENCE : FOCUS_OUT_SEQUENCE);
      }
    }

    focusProbeBuffer = combined.slice(-FOCUS_TRACKING_PROBE_LEN);
  };

  const shouldClearScrollback = (data: string): boolean => {
    if (data.length === 0) return false;
    // Only check the current segment, not a cross-segment sliding window.
    // The sliding window was meant to catch escape sequences split across
    // PTY write boundaries, but its persistence across segments caused
    // false positives when binary output (find, cat on binaries, etc.)
    // passes \x1b, [, 3, and J bytes within the 128-byte probe window.
    // If a legitimate \x1b[3J is split across segments, the missing
    // preemptive detection is harmless — getCurrentScrollState adjusts
    // viewportOffset correctly based on the actual scrollbackLength delta
    // when the emulator processes the sequence and fires onUpdate.
    return (
      hasScrollbackEraseSequence(data, SCROLLBACK_CLEAR_REGEX) ||
      hasScrollbackEraseSequence(data, SCROLLBACK_CLEAR_C1_REGEX)
    );
  };

  const resetScrollbackState = () => {
    session.scrollbackArchive.reset();
    session.scrollbackArchiver?.reset();
    session.scrollState.viewportOffset = 0;
    session.scrollState.lastScrollbackLength = 0;
    session.scrollState.lastIsAtBottom = true;
  };

  const flushPendingResponses = () => {
    while (state.pendingResponses.length > 0) {
      const next = state.pendingResponses[0];
      if (next.fence > state.processedCounter) break;
      state.pendingResponses.shift();
      for (const response of next.responses) {
        session.pty.write(response);
      }
    }
  };

  const rawBufferIsEmpty = () => state.rawBufferLength === 0;
  const rawBufferJoin = () => state.rawChunks.join('');
  const rawBufferClear = () => {
    state.rawChunks = [];
    state.rawBufferLength = 0;
  };
  const rawBufferAppend = (data: string) => {
    state.rawChunks.push(data);
    state.rawBufferLength += data.length;
  };

  const drainPending = (drainOptions?: { force?: boolean }) => {
    lastDrainTime = now();
    session.pendingNotify = false;

    if (session.emulator.isDisposed) {
      state.pendingSegments = [];
      state.rawChunks = [];
      state.rawBufferLength = 0;
      return;
    }

    // If we have raw-buffered data from a hidden period, process it first.
    // For force drains (background pulse, focus transition), process the
    // entire buffer. For budgeted drains, process one chunk per cycle.
    const force = drainOptions?.force ?? false;
    if (!rawBufferIsEmpty()) {
      // For the focused PTY, always replay the full raw buffer.
      // The drain budget (8ms) will limit how much work we do per cycle,
      // and any remaining segments will be processed in the next drain.
      // For background PTYs, only replay the full buffer on force drains
      // (focus transitions, background pulses).
      const priority = getPriority();
      if (force || priority === 'focused') {
        replayRawBufferFull();
      } else {
        replayRawBuffer();
      }
    }

    if (state.pendingSegments.length === 0) {
      flushPendingResponses();
      return;
    }

    const config = getPriorityConfig(getPriority());
    const start = now();
    let batch = '';
    let batchLen = 0;
    let segmentsProcessed = 0;
    let wrote = false;

    if (force) {
      while (state.pendingSegments.length > 0) {
        let segment = state.pendingSegments.shift() ?? '';
        if (segment.length === 0) continue;
        // Suppress ALL clear sequences during resize suppression window
        if (shouldSuppressClearScreen(session)) {
          segment = segment
            .replace(SCROLLBACK_CLEAR_REGEX, '')
            .replace(SCROLLBACK_CLEAR_C1_REGEX, '');
          segment = suppressClearScreenSequences(segment);
          if (segment.length === 0) continue;
        }
        if (segment.length > 0) {
          // Only check for scrollback clear if NOT in suppression window
          if (shouldClearScrollback(segment)) {
            resetScrollbackState();
          }
          session.emulator.write(segment);
          wrote = true;
        }
        segmentsProcessed += 1;
      }
    } else {
      while (state.pendingSegments.length > 0) {
        const segment = state.pendingSegments[0];
        if (segment.length === 0) {
          state.pendingSegments.shift();
          continue;
        }

        if (batchLen > 0 && batchLen + segment.length > config.maxCharsPerTick) {
          break;
        }

        batch += segment;
        batchLen += segment.length;
        segmentsProcessed += 1;
        state.pendingSegments.shift();

        if (segmentsProcessed >= config.maxSegmentsPerTick) break;
        if (batchLen >= config.maxCharsPerTick) break;
        if (now() - start >= config.drainBudgetMs) break;
      }

      if (batchLen === 0 && state.pendingSegments.length > 0) {
        batch = state.pendingSegments.shift() ?? '';
      }

      if (batch.length > 0) {
        // Suppress ALL clear sequences during resize suppression window (both CSI 2 J and CSI 3 J)
        // Shells send these during SIGWINCH handling - dropping them preserves reflowed content
        if (shouldSuppressClearScreen(session)) {
          // First suppress CSI 3 J (scrollback clear) to prevent resetScrollbackState()
          batch = batch.replace(SCROLLBACK_CLEAR_REGEX, '').replace(SCROLLBACK_CLEAR_C1_REGEX, '');
          // Then suppress CSI 2 J (screen clear)
          batch = suppressClearScreenSequences(batch);
        }
        if (batch.length > 0) {
          // Only check for scrollback clear if NOT in suppression window
          if (shouldClearScrollback(batch)) {
            resetScrollbackState();
          }
          session.emulator.write(batch);
          wrote = true;
        }
      }
    }

    if (wrote && !session.emulator.isDisposed) {
      const responses = session.emulator.drainResponses?.();
      if (responses && responses.length > 0) {
        // Process clipboard responses separately (copy to system clipboard)
        // and filter them out from PTY responses
        const ptyResponses = processClipboardResponses(
          responses,
          session.id,
          options.copyToClipboard
        );
        for (const response of ptyResponses) {
          tracePtyChunk('emulator-response', response, { ptyId: session.id });
          session.pty.write(response);
        }
      }
    }

    if (wrote) {
      // Data was written to the emulator — schedule scroller archiver.
      isFirstDrainInBurst = false;
      session.scrollbackArchiver?.schedule();

      // Flush pending emulator notification synchronously. The emulator's
      // write() defers prepareUpdate + notifySubscribers via setImmediate
      // for coalescing (multiple writes in one tick = one update). But we've
      // just finished draining ALL pending segments, so there won't be more
      // writes in this tick. Flush now to eliminate a setImmediate cycle
      // (~4-8ms) between drain completion and subscriber notification.
      session.emulator.flushPendingNotify?.();
    }

    if (segmentsProcessed > 0) {
      state.processedCounter += segmentsProcessed;
      flushPendingResponses();
    }

    if (state.pendingSegments.length > 0) {
      scheduleNotify();
    } else {
      // Burst ended
      isFirstDrainInBurst = true;
    }
  };

  // Tracks whether data was written to the emulator during the current
  // drain cycle. Used by drainPending to schedule scrollback archiver.
  let isFirstDrainInBurst = true;

  // Priority-aware scheduling: the drain interval is determined by
  // the PTY's current priority level (focused = 0ms, background-visible = 1000ms).
  // Background-hidden PTYs are not drained at all — data accumulates in
  // pendingSegments until the PTY becomes visible or focused.
  // This replaces the previous adaptive heuristic — the priority system
  // is the single source of truth for scheduling decisions.
  const scheduleNotify = () => {
    if (!session.pendingNotify) {
      const priority = getPriority();
      if (priority === 'background-hidden') return;
      session.pendingNotify = true;

      // For the focused PTY, use setImmediate for drain scheduling.
      // setImmediate runs before setTimeout(0) I/O callbacks in Bun,
      // giving microtask-like latency without starving the macrotask queue.
      //
      // Frame skipping in replayRawBufferFull handles backpressure:
      // when multiple sync-mode frames accumulate in the raw buffer,
      // only the last frame is processed through the VT parser.
      if (priority === 'focused') {
        setImmediate(() => {
          if (session.pendingNotify) {
            drainPending();
          }
        });
        return;
      }

      const config = getPriorityConfig(priority);
      const sinceLastDrain = now() - lastDrainTime;
      const interval = config.drainIntervalMs;
      const delay = sinceLastDrain < interval ? interval - sinceLastDrain : 0;
      if (delay > 0) {
        setTimeout(
          () => {
            if (session.pendingNotify) drainPending();
          },
          Math.min(delay, 2_147_483_647)
        );
      } else {
        deferMacrotask(drainPending);
      }
    }
  };

  /**
   * Replay raw-buffered data through the full pipeline (single chunk).
   * Only processes one maxCharsPerTick worth of data per call.
   * The caller (drainPending) calls this repeatedly across drain cycles
   * until the buffer is exhausted.
   */
  const replayRawBuffer = () => {
    if (rawBufferIsEmpty()) return;

    const maxChunk = getPriorityConfig(getPriority()).maxCharsPerTick;

    if (state.rawBufferLength <= maxChunk) {
      const raw = rawBufferJoin();
      rawBufferClear();
      processChunk(raw);
      return;
    }

    // Large buffer: join, slice, and keep the remainder.
    const raw = rawBufferJoin();
    let end = maxChunk;
    const nl = raw.indexOf('\n', end);
    if (nl !== -1 && nl < end + 1024) {
      end = nl + 1;
    } else {
      end = Math.min(end, raw.length);
    }

    const chunk = raw.slice(0, end);
    state.rawChunks = [raw.slice(end)];
    state.rawBufferLength -= end;
    processChunk(chunk);
  };

  /**
   * Replay the ENTIRE raw buffer in one go (for focus transitions and force drains).
   * This may block the event loop for large buffers, but the user expects
   * immediate data when switching focus to a previously hidden PTY.
   */
  const replayRawBufferFull = () => {
    if (state.rawBufferLength === 0) return;
    const raw = rawBufferJoin();
    rawBufferClear();

    // Frame skip optimization: when the raw buffer contains multiple
    // complete sync-mode frames (\x1b[?2026h...\x1b[?2026l), skip all
    // but the last one. Each sync-mode frame from an opentui app is a
    // complete screen redraw — intermediate frames are completely
    // overwritten by subsequent frames. Processing them through the
    // VT parser is wasted CPU (~5-10ms per frame for 253KB of truecolor
    // ANSI). This cuts the drain time from O(n frames) to O(1 frame)
    // for animation backpressure scenarios.
    //
    // Algorithm: find the last sync-set (\x1b[?2026h) that has a
    // matching sync-reset (\x1b[?2026l) after it. Everything before
    // that sync-set can be skipped (with the exception of any non-sync
    // data like query responses, which must still be processed).
    let syncStartIdx = -1;

    // Search from the end for the last complete sync frame
    let searchFrom = raw.length;
    while (searchFrom > 0) {
      const idx7 = raw.lastIndexOf(SYNC_SET, searchFrom);
      const idx8 = raw.lastIndexOf(SYNC_SET_C1, searchFrom);
      const idx = Math.max(idx7, idx8);
      if (idx === -1) break;

      // Check if this sync-set has a matching sync-reset after it
      const afterSync = raw.slice(idx);
      const resetIdx7 = afterSync.indexOf(SYNC_RESET);
      const resetIdx8 = afterSync.indexOf(SYNC_RESET_C1);
      const resetOffset =
        resetIdx7 !== -1 && resetIdx8 !== -1
          ? Math.min(resetIdx7, resetIdx8)
          : resetIdx7 !== -1
            ? resetIdx7
            : resetIdx8;

      if (resetOffset !== -1) {
        // Found a complete sync frame starting at idx
        syncStartIdx = idx;
        break;
      }

      // This sync-set has no matching reset — continue searching earlier
      searchFrom = idx - 1;
    }

    if (syncStartIdx > 0) {
      // Count skipped frames for tracing
      const beforeSyncStart = raw.slice(0, syncStartIdx);
      const skippedCount =
        countOccurrences(beforeSyncStart, SYNC_SET) +
        countOccurrences(beforeSyncStart, SYNC_SET_C1);

      if (skippedCount > 0) {
        tracePtyEvent('pty-frame-skip', {
          ptyId: session.id,
          skippedFrames: skippedCount,
          rawLength: raw.length,
          keptLength: raw.length - syncStartIdx,
        });
      }

      // Process any data before the last frame that is NOT inside a sync
      // boundary. Non-sync data (query responses, partial output) must be
      // processed for correctness. Sync-mode frames before the last one
      // are dropped.
      //
      // Strategy: strip all complete sync-mode frames from the prefix.
      // Any remaining data is non-sync and must be processed.
      const stripped = stripSyncFrames(beforeSyncStart);
      if (stripped.length > 0) {
        processChunk(stripped);
      }
      // Process the last complete frame
      processChunk(raw.slice(syncStartIdx));
      return;
    }

    processChunk(raw);
  };

  // The data handler function
  const handleData = (data: string) => {
    const priority = getPriority();

    // background (visible or hidden): skip all processing, buffer raw data.
    // Even for background-visible, running every chunk through processChunk
    // (regex analysis, sync mode parsing, emulator.write) is too expensive
    // under heavy output like `find / -ls`. The per-chunk cost adds up
    // to significant event loop pressure that starves the focused pane's
    // render loop and makes scrolling sluggish.
    //
    // Instead, background PTYs just concatenate raw strings (O(1) amortized)
    // and the 1fps pulse drains the buffer in one batch.
    // On focus switch, replayRawBufferFull flushes everything immediately.
    if (priority !== 'focused') {
      if (state.rawBufferLength < RAW_BUFFER_MAX_SIZE) {
        rawBufferAppend(data);
      }
      return;
    }

    // Focused PTY: accumulate data and schedule a microtask drain.
    // Processing every chunk through processChunk synchronously blocks
    // the main thread under heavy output (find / -ls produces thousands
    // of chunks/second). The regex analysis, sync mode parsing, and
    // emulator.write all add up to significant event loop pressure.
    //
    // Instead, we buffer the raw data (like background PTYs) and
    // schedule a drain via queueMicrotask. The drain budget (8ms)
    // ensures we yield between cycles for user input. queueMicrotask
    // runs before the next macrotask, so the drain+render completes
    // before new I/O events, keeping the UI responsive.
    if (state.rawBufferLength < RAW_BUFFER_MAX_SIZE) {
      rawBufferAppend(data);
    }
    scheduleNotify();
  };

  // The core processing pipeline — extracted so replayRawBuffer can call it.
  const processChunk = (data: string) => {
    tracePtyChunk('pty-in', data, { ptyId: session.id });
    updateFocusTracking(data);
    const kittySignals = analyzeKitty(data);
    const hasKittyQuery = kittySignals.hasKittyQuery;
    let textData: string;
    let deferredResponses: string[] | null = null;

    // Handle terminal queries (cursor position, device attributes, colors, etc.)
    if (hasKittyQuery && 'processWithResponses' in session.queryPassthrough) {
      const processed = session.queryPassthrough.processWithResponses(data);
      textData = processed.text;
      deferredResponses = processed.responses;
    } else {
      textData = session.queryPassthrough.process(data);
    }

    if (commandParser) {
      void commandParser.processData(textData);
    }

    // Process through sync mode parser to respect frame boundaries
    // This buffers content between CSI ? 2026 h and CSI ? 2026 l
    const { readySegments, isBuffering } = syncParser.process(textData);

    // Handle sync buffering timeout (safety valve)
    // Reset the timer on every buffered chunk so large synchronized frames
    // don't get flushed midway through active streaming.
    if (isBuffering) {
      state.syncLikelyPiFullRedraw ||= RAW_PI_SYNC_FULL_REDRAW_START_REGEX.test(data);
      if (state.syncTimeout) {
        clearTimeout(state.syncTimeout);
      }
      const timeoutMs = state.syncLikelyPiFullRedraw
        ? Math.max(syncTimeoutMs, PI_SYNC_TIMEOUT_MS)
        : syncTimeoutMs;
      state.syncTimeout = setTimeout(() => {
        // Safety flush - sync mode went idle for too long (app may have crashed)
        const flushed = normalizePiFullRedrawSegment(syncParser.flush(), session.rows);
        tracePtyEvent('pty-sync-timeout-flush', {
          ptyId: session.id,
          timeoutMs,
          piFullRedraw: state.syncLikelyPiFullRedraw,
          flushedLen: flushed.length,
        });
        if (flushed.length > 0) {
          state.pendingSegments.push(flushed);
          scheduleNotify();
        }
        state.syncTimeout = null;
        state.syncLikelyPiFullRedraw = false;
      }, timeoutMs);
    } else {
      if (state.syncTimeout) {
        clearTimeout(state.syncTimeout);
        state.syncTimeout = null;
      }
      state.syncLikelyPiFullRedraw = false;
    }

    // Add ready segments to pending queue
    let segmentsAdded = 0;
    for (const rawSegment of readySegments) {
      const isPiRedraw = PI_FULL_REDRAW_PREFIX_REGEX.test(rawSegment);
      const segment = normalizePiFullRedrawSegment(rawSegment, session.rows);
      if (segment.length > 0) {
        state.pendingSegments.push(segment);
        segmentsAdded += 1;
      }
    }
    if (segmentsAdded > 0) {
      state.segmentCounter += segmentsAdded;
    }

    if (deferredResponses && deferredResponses.length > 0) {
      for (const response of deferredResponses) {
        tracePtyChunk('pty-query-response', response, {
          ptyId: session.id,
          deferred: true,
        });
      }
      state.pendingResponses.push({
        fence: state.segmentCounter,
        responses: deferredResponses,
      });
      if (state.pendingSegments.length === 0) {
        flushPendingResponses();
      }
    }

    // Only schedule notification if we have data and aren't buffering
    // When buffering, we wait for the complete frame before notifying
    if (!isBuffering && state.pendingSegments.length > 0) {
      if (kittySignals.hasKittyApc) {
        drainPending({ force: true });
      } else {
        scheduleNotify();
      }
    }
  };

  // Incremental flush: drain without force (uses capped replayRawBuffer).
  // This is used by the 1fps background pulse to avoid processing the
  // entire raw buffer through the VT pipeline in one shot.
  const incrementalDrain = () => {
    drainPending();
  };

  /**
   * Write raw data directly to the emulator, bypassing the full pipeline.
   * Used by the 1fps background pulse for background PTYs where the full
   * parsing pipeline (clipboard, sync mode, focus tracking) is overkill.
   * The emulator's updatesEnabled is false, so no cell conversion happens.
   * Capped at 64KB per call to avoid blocking the event loop with a
   * massive native VT parse. The raw buffer retains what's left for
   * subsequent pulses or for replayRawBufferFull on focus switch.
   *
   * Routes through processChunk so that CSI 2J normalization runs before
   * the data reaches the emulator. Without this, un-normalized CSI 2J
   * triggers ghostty's scrollClear heuristic (pushes viewport to
   * scrollback at a prompt), producing duplicate scrollback content.
   */
  const drainRawToEmulator = () => {
    if (rawBufferIsEmpty()) return;

    const MAX_RAW_DRAIN = 65_536; // ~1 screenful of VT data

    if (state.rawBufferLength <= MAX_RAW_DRAIN) {
      const raw = rawBufferJoin();
      rawBufferClear();
      processChunk(raw);
      drainPending({ force: true });
      return;
    }

    // Large buffer: process one chunk from the head. The rest stays
    // buffered and will be processed on the next pulse or on focus switch.
    const raw = rawBufferJoin();
    let end = MAX_RAW_DRAIN;
    // Snap forward past the last newline to avoid splitting mid-line.
    const nlIdx = raw.indexOf('\n', end);
    if (nlIdx !== -1 && nlIdx < end + 1024) {
      end = nlIdx + 1;
    }

    const chunk = raw.slice(0, end);
    state.rawChunks = [raw.slice(end)];
    state.rawBufferLength -= end;
    processChunk(chunk);
    drainPending({ force: true });
  };

  // Cleanup function to clear any pending timeouts
  const cleanup = () => {
    if (state.syncTimeout) {
      clearTimeout(state.syncTimeout);
      state.syncTimeout = null;
    }
  };

  return {
    handleData,
    cleanup,
    scheduleNotify,
    drainPending,
    incrementalDrain,
    drainRawToEmulator,
  };
}
