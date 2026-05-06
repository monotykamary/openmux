import { Buffer } from 'buffer';

import type { TerminalScrollState, UnifiedTerminalUpdate } from '../../core/types';
import type { SerializedDirtyUpdate } from '../../terminal/emulator-interface';
import { getFocusedPtyId } from '../../terminal/focused-pty-registry';
import { getHostFocusState } from '../../terminal/host-focus';
import {
  sendDesktopNotification,
  sendMacOsNotification,
} from '../../terminal/desktop-notifications';
import { unpackDirtyUpdate } from '../../terminal/cell-serialization';
import type { DesktopNotification } from '../../terminal/command-parser';
import { bufferToArrayBuffer } from './utils';
import { defaultRegistry } from './state';
import type { ShimHeader } from '../protocol';

/** Dependencies for creating a frame handler */
export type FrameHandlerDeps = {
  /** Callback for handling response frames */
  onResponse: (header: ShimHeader, payloads: Buffer[]) => boolean;
  /** Callback when client is detached by server */
  onDetached: () => void;
};

/**
 * Builds a packed dirty update from a frame header and payloads.
 * Deserializes the packed metadata and binary data.
 * @param header - Frame header with packed metadata
 * @param payloads - Binary payloads containing row data
 * @returns Serialized dirty update or null if invalid
 */
function buildPackedUpdate(header: ShimHeader, payloads: Buffer[]): SerializedDirtyUpdate | null {
  const packedMeta = header.packed as
    | {
        cursor: { x: number; y: number; visible: boolean };
        cols: number;
        rows: number;
        scrollbackLength: number;
        isFull: boolean;
        alternateScreen: boolean;
        mouseTracking: boolean;
        cursorKeyMode: number;
        kittyKeyboardFlags?: number;
        inBandResize: boolean;
      }
    | undefined;

  if (!packedMeta) {
    return null;
  }

  const dirtyRowIndices = new Uint16Array(bufferToArrayBuffer(payloads[0] ?? Buffer.alloc(0)));
  const dirtyRowData = bufferToArrayBuffer(payloads[1] ?? Buffer.alloc(0));
  const fullStateBuffer = payloads[2] ? bufferToArrayBuffer(payloads[2]) : undefined;

  return {
    dirtyRowIndices,
    dirtyRowData,
    fullStateData: fullStateBuffer,
    cursor: packedMeta.cursor,
    cols: packedMeta.cols,
    rows: packedMeta.rows,
    scrollbackLength: packedMeta.scrollbackLength,
    isFull: packedMeta.isFull,
    alternateScreen: packedMeta.alternateScreen,
    mouseTracking: packedMeta.mouseTracking,
    cursorKeyMode: packedMeta.cursorKeyMode as 0 | 1,
    kittyKeyboardFlags: packedMeta.kittyKeyboardFlags ?? 0,
    inBandResize: packedMeta.inBandResize,
  };
}

/**
 * Reads a boolean environment variable.
 * @param name - Environment variable name
 * @returns true if the value is '1', 'true', or 'on'
 */
function readBoolEnv(name: string): boolean {
  const raw = (process.env[name] ?? '').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}

/**
 * Handles desktop notifications from the shim server.
 * Routes to macOS native notifications when host focused and pane unfocused,
 * otherwise uses standard desktop notifications.
 * @param params - Notification parameters including focus state
 * @param deps - Notification sender dependencies
 */
export function handlePtyNotification(
  params: {
    notification: DesktopNotification;
    subtitle?: string;
    ptyId?: string;
    hostFocused: boolean | null;
    focusedPtyId: string | null;
    allowFocusedPaneOsc: boolean;
  },
  deps: {
    sendMacOsNotification: (args: { title: string; subtitle?: string; body: string }) => boolean;
    sendDesktopNotification: (args: {
      notification: DesktopNotification;
      subtitle?: string;
    }) => boolean;
  }
): void {
  const { notification, subtitle, ptyId, hostFocused, focusedPtyId, allowFocusedPaneOsc } = params;
  const isUnfocusedPane = Boolean(ptyId && focusedPtyId && ptyId !== focusedPtyId);
  const shouldUseMacOs = hostFocused === true && (isUnfocusedPane || !allowFocusedPaneOsc);

  if (shouldUseMacOs) {
    const sent = deps.sendMacOsNotification({
      title: notification.title,
      subtitle,
      body: notification.body,
    });
    if (sent) {
      return;
    }
  }

  deps.sendDesktopNotification({ notification, subtitle });
}

/**
 * Creates a frame handler for processing shim server messages.
 * Routes different frame types to appropriate handlers.
 * @param deps - Frame handler dependencies
 * @returns Handler function for incoming frames
 */
export function createFrameHandler(
  deps: FrameHandlerDeps
): (header: ShimHeader, payloads: Buffer[]) => void {
  return (header, payloads) => {
    if (deps.onResponse(header, payloads)) {
      return;
    }

    if (header.type === 'ptyUpdate') {
      const ptyId = header.ptyId as string;
      const packed = buildPackedUpdate(header, payloads);
      if (!packed) {
        return;
      }

      const scrollStateHeader = header.scrollState as
        | { viewportOffset: number; isAtBottom: boolean }
        | undefined;
      const scrollState: TerminalScrollState = {
        viewportOffset: scrollStateHeader?.viewportOffset ?? 0,
        scrollbackLength: packed.scrollbackLength,
        isAtBottom: scrollStateHeader?.isAtBottom ?? true,
      };

      const dirtyUpdate = unpackDirtyUpdate(packed, scrollState);
      const unifiedUpdate: UnifiedTerminalUpdate = {
        terminalUpdate: dirtyUpdate,
        scrollState,
      };

      defaultRegistry.handleUnifiedUpdate(ptyId, unifiedUpdate);
      return;
    }

    if (header.type === 'ptyExit') {
      const ptyId = header.ptyId as string;
      const exitCode = header.exitCode as number;
      defaultRegistry.handlePtyExit(ptyId, exitCode);
      return;
    }

    if (header.type === 'ptyKitty') {
      const ptyId = header.ptyId as string;
      const kitty = header.kitty as
        | {
            images?: Array<{
              id: number;
              number: number;
              width: number;
              height: number;
              dataLength: number;
              format: number;
              compression: number;
              implicitId: boolean;
              transmitTime: string;
            }>;
            placements?: Array<{
              imageId: number;
              placementId: number;
              placementTag: number;
              screenX: number;
              screenY: number;
              xOffset: number;
              yOffset: number;
              sourceX: number;
              sourceY: number;
              sourceWidth: number;
              sourceHeight: number;
              columns: number;
              rows: number;
              z: number;
            }>;
            removedImageIds?: number[];
            imageDataIds?: number[];
            alternateScreen?: boolean;
          }
        | undefined;

      if (!kitty) return;

      const imageDataIds = kitty.imageDataIds ?? [];
      const imageData = new Map<number, Uint8Array>();
      for (let i = 0; i < imageDataIds.length; i++) {
        const payload = payloads[i];
        if (!payload) continue;
        imageData.set(imageDataIds[i], payload);
      }

      const images = (kitty.images ?? []).map((info) => ({
        id: info.id,
        number: info.number,
        width: info.width,
        height: info.height,
        dataLength: info.dataLength,
        format: info.format,
        compression: info.compression,
        implicitId: info.implicitId,
        transmitTime: BigInt(info.transmitTime),
      }));

      defaultRegistry.handlePtyKittyUpdate(ptyId, {
        images,
        placements: kitty.placements ?? [],
        removedImageIds: kitty.removedImageIds ?? [],
        imageData,
        alternateScreen: kitty.alternateScreen ?? false,
      });
      return;
    }

    if (header.type === 'ptyKittyTransmit') {
      const ptyId = header.ptyId as string;
      const payload = payloads[0];
      if (!payload) return;
      defaultRegistry.handlePtyKittyTransmit(ptyId, payload.toString('utf8'));
      return;
    }

    if (header.type === 'ptyTitle') {
      const ptyId = header.ptyId as string;
      const title = (header.title as string) ?? '';
      defaultRegistry.handlePtyTitle(ptyId, title);
      return;
    }

    if (header.type === 'ptyActivity') {
      const ptyId = header.ptyId as string;
      defaultRegistry.handlePtyActivity(ptyId);
      return;
    }

    if (header.type === 'ptyNotification') {
      const notification = header.notification as DesktopNotification | undefined;
      if (!notification) return;
      const subtitle = typeof header.subtitle === 'string' ? header.subtitle : undefined;
      const ptyId = header.ptyId as string | undefined;
      const hostFocused = getHostFocusState();
      const focusedPtyId = getFocusedPtyId();
      const allowFocusedPaneOsc = readBoolEnv('OPENMUX_ALLOW_FOCUSED_PANE_OSC');
      handlePtyNotification(
        {
          notification,
          subtitle,
          ptyId,
          hostFocused,
          focusedPtyId,
          allowFocusedPaneOsc,
        },
        {
          sendMacOsNotification,
          sendDesktopNotification,
        }
      );
      return;
    }

    if (header.type === 'ptyLifecycle') {
      const ptyId = header.ptyId as string;
      const eventType = header.event as 'created' | 'destroyed';
      defaultRegistry.handlePtyLifecycle(ptyId, eventType);
      return;
    }

    if (header.type === 'detached') {
      deps.onDetached();
    }
  };
}
