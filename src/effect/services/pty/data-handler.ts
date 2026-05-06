/**
 * PTY data handler factory - creates the data processing pipeline (errore version)
 * Handles sync mode parsing and query passthrough.
 */
import type { SyncModeParser } from '../../../terminal/sync-mode-parser';
import type { InternalPtySession } from './types';
import { deferMacrotask } from '../../../core/scheduling';
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
}

interface DataHandlerState {
  pendingSegments: string[];
  syncTimeout: ReturnType<typeof setTimeout> | null;
  syncLikelyPiFullRedraw: boolean;
  /** Set when a pi full-redraw segment is queued; cleared after drain processes it. */
  piFullRedrawPending: boolean;
  pendingResponses: { fence: number; responses: string[] }[];
  segmentCounter: number;
  processedCounter: number;
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
const SCROLLBACK_CLEAR_PROBE_LEN = 128;
const SCROLLBACK_CLEAR_REGEX = /\x1b\[([0-9;]*)J/g;
const SCROLLBACK_CLEAR_C1_REGEX = /\x9b([0-9;]*)J/g;

// Clear-screen suppression after resize (prevents shell SIGWINCH clears from destroying reflowed content)
const CLEAR_SUPPRESSION_WINDOW_MS = 50;
const CLEAR_SCREEN_REGEX = /\x1b\[2J/g;
const CLEAR_SCREEN_C1_REGEX = /\x9b2J/g;

// Pi full redraws reach data-handler after sync-mode-parser has already stripped
// CSI ? 2026 h/l. Normalize the post-sync payload instead of looking for sync markers.
const CURSOR_HOME_SEQUENCE = '\x1b[H';
const PI_FULL_REDRAW_PREFIX_REGEX =
  /^(?:\x1b\[2J|\x9b2J)(?:\x1b\[(?:H|1;1H)|\x9b(?:H|1;1H))(?:\x1b\[3J|\x9b3J)/;
const RAW_PI_SYNC_FULL_REDRAW_START_REGEX =
  /\x1b\[\?2026h(?:\x1b\[2J|\x9b2J)(?:\x1b\[(?:H|1;1H)|\x9b(?:H|1;1H))(?:\x1b\[3J|\x9b3J)/;
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

/**
 * Replace pi's destructive full-redraw prefix with a cursor-home replacement.
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
 * linefeed-based scrolling. By stripping the entire clear prefix (CSI 2J + CSI H +
 * CSI 3J) and replacing it with just cursor-home, the frame content overwrites the
 * existing visible rows in place — no scrollback duplication, no content shift.
 *
 * Sync-mode-parser's atomic delivery guarantees no intermediate stale state is
 * rendered, so there is no flicker.
 *
 * @internal Exported for testing
 */
export function normalizePiFullRedrawSegment(segment: string, _terminalRows: number): string {
  const match = segment.match(PI_FULL_REDRAW_PREFIX_REGEX);
  if (!match) return segment;

  const frame = segment.slice(match[0].length);
  return `${CURSOR_HOME_SEQUENCE}${frame}`;
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
  const maxSegmentsPerTick = 8;
  const maxCharsPerTick = 32_768;
  const maxBudgetMs = 4;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  const state: DataHandlerState = {
    pendingSegments: [],
    syncTimeout: null,
    syncLikelyPiFullRedraw: false,
    piFullRedrawPending: false,
    pendingResponses: [],
    segmentCounter: 0,
    processedCounter: 0,
  };
  let kittyProbeBuffer = '';
  let focusProbeBuffer = '';
  let scrollbackClearBuffer = '';

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
    let combined = scrollbackClearBuffer + data;
    if (combined.length > 2048) {
      combined = combined.slice(-2048);
    }
    scrollbackClearBuffer = combined.slice(-SCROLLBACK_CLEAR_PROBE_LEN);

    return (
      hasScrollbackEraseSequence(combined, SCROLLBACK_CLEAR_REGEX) ||
      hasScrollbackEraseSequence(combined, SCROLLBACK_CLEAR_C1_REGEX)
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

  const drainPending = (drainOptions?: { force?: boolean }) => {
    session.pendingNotify = false;

    if (session.emulator.isDisposed) {
      state.pendingSegments = [];
      return;
    }

    if (state.pendingSegments.length === 0) {
      flushPendingResponses();
      return;
    }

    const force = drainOptions?.force ?? false;
    const piRedraw = state.piFullRedrawPending;
    // Snapshot scrollback length before writing a pi full redraw so we can
    // detect and undo any LF-triggered scrollback growth.
    const preWriteScrollback = piRedraw ? session.emulator.getScrollbackLength() : 0;
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

        if (batchLen > 0 && batchLen + segment.length > maxCharsPerTick) {
          break;
        }

        batch += segment;
        batchLen += segment.length;
        segmentsProcessed += 1;
        state.pendingSegments.shift();

        if (segmentsProcessed >= maxSegmentsPerTick) break;
        if (batchLen >= maxCharsPerTick) break;
        if (now() - start >= maxBudgetMs) break;
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
      session.scrollbackArchiver?.schedule();
    }

    // After writing a pi full redraw, check if any scrollback grew from
    // LF-triggered scrolls and virtually trim the duplicate tail lines.
    // With cursor-positioned frames (like OpenTUI), there should be zero
    // growth. This is a safety net for edge cases.
    if (piRedraw && wrote && !session.emulator.isDisposed) {
      const postWriteScrollback = session.emulator.getScrollbackLength();
      const growth = postWriteScrollback - preWriteScrollback;
      if (growth > 0) {
        tracePtyEvent('pi-redraw-scrollback-growth', {
          ptyId: session.id,
          growth,
          preWriteScrollback,
          postWriteScrollback,
        });
        if (typeof session.emulator.eraseScrollbackTail === 'function') {
          session.emulator.eraseScrollbackTail(growth);
        }
      }
      state.piFullRedrawPending = false;
    }

    if (segmentsProcessed > 0) {
      state.processedCounter += segmentsProcessed;
      flushPendingResponses();
    }

    if (state.pendingSegments.length > 0) {
      scheduleNotify();
    }
  };

  // Helper to schedule notification (uses macrotask to yield for rendering)
  const scheduleNotify = () => {
    if (!session.pendingNotify) {
      session.pendingNotify = true;
      deferMacrotask(drainPending);
    }
  };

  // The data handler function
  const handleData = (data: string) => {
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
          if (state.syncLikelyPiFullRedraw) {
            state.piFullRedrawPending = true;
          }
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
        if (isPiRedraw) {
          state.piFullRedrawPending = true;
        }
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

  // Cleanup function to clear any pending timeouts
  const cleanup = () => {
    if (state.syncTimeout) {
      clearTimeout(state.syncTimeout);
      state.syncTimeout = null;
    }
  };

  return { handleData, cleanup, scheduleNotify };
}
