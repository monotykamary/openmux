import { onCleanup, onMount } from 'solid-js';
import { deferNextTick } from '../../core/scheduling';
import {
  KittyGraphicsRenderer,
  KittyTransmitBroker,
  setKittyGraphicsRenderer,
  setKittyTransmitBroker,
} from '../../terminal/kitty-graphics';
import { isShimClient } from '../../shim/mode';
import { subscribeKittyTransmit, subscribeKittyUpdate } from '../../shim/client';

export function createKittyGraphicsBridge(params: {
  renderer: unknown;
  ensurePixelResize: () => void;
  stopPixelResizePoll: () => void;
}): KittyGraphicsRenderer {
  const { renderer, ensurePixelResize, stopPixelResizePoll } = params;
  const kittyRenderer = new KittyGraphicsRenderer();
  const kittyBroker = new KittyTransmitBroker();
  setKittyGraphicsRenderer(kittyRenderer);
  setKittyTransmitBroker(kittyBroker);

  onMount(() => {
    const rendererAny = renderer as any;
    const originalRenderNative = rendererAny.renderNative?.bind(rendererAny);
    const pixelResolutionRegex = /\x1b\[4;\d+;\d+t/;
    const kittyResponseStartRegex = /(?:\x1b_G|\x9fG)/;
    const kittyResponseEndRegex = /(?:\x1b\\|\x9c)/;
    let kittyResponseBuffer = '';

    const handlePixelResolution = (sequence: string) => {
      if (!pixelResolutionRegex.test(sequence)) return false;
      deferNextTick(() => {
        ensurePixelResize();
      });
      return false;
    };

    const handleKittyResponses = (sequence: string) => {
      if (kittyResponseBuffer.length > 0) {
        kittyResponseBuffer += sequence;
        if (kittyResponseEndRegex.test(kittyResponseBuffer)) {
          kittyResponseBuffer = '';
        } else if (kittyResponseBuffer.length > 4096) {
          kittyResponseBuffer = '';
        }
        return true;
      }

      if (!kittyResponseStartRegex.test(sequence)) return false;
      if (!kittyResponseEndRegex.test(sequence)) {
        kittyResponseBuffer = sequence;
      }
      return true;
    };

    if (originalRenderNative) {
      rendererAny.renderNative = () => {
        originalRenderNative();
        kittyRenderer.flush(rendererAny);
      };
    }

    kittyBroker.setRenderer(rendererAny);
    kittyBroker.setAutoFlush(false);
    kittyBroker.setFlushScheduler(() => {
      rendererAny.requestRender?.();
    });
    let unsubscribeTransmit: (() => void) | null = null;
    let unsubscribeKittyUpdate: (() => void) | null = null;
    if (isShimClient()) {
      unsubscribeTransmit = subscribeKittyTransmit((event) => {
        kittyBroker.handleSequence(event.ptyId, event.sequence);
        queueMicrotask(() => {
          kittyBroker.flushPending();
        });
      });
      unsubscribeKittyUpdate = subscribeKittyUpdate(() => {
        queueMicrotask(() => {
          kittyRenderer.flush(rendererAny);
        });
        rendererAny.requestRender?.();
      });
    }
    rendererAny.prependInputHandler?.(handleKittyResponses);
    rendererAny.prependInputHandler?.(handlePixelResolution);
    ensurePixelResize();

    onCleanup(() => {
      if (originalRenderNative) {
        rendererAny.renderNative = originalRenderNative;
      }
      kittyBroker.setAutoFlush(true);
      kittyBroker.setFlushScheduler(null);
      rendererAny.removeInputHandler?.(handleKittyResponses);
      rendererAny.removeInputHandler?.(handlePixelResolution);
      stopPixelResizePoll();
      unsubscribeTransmit?.();
      unsubscribeKittyUpdate?.();
      kittyRenderer.dispose();
      kittyBroker.dispose();
      setKittyGraphicsRenderer(null);
      setKittyTransmitBroker(null);
      kittyResponseBuffer = '';
    });
  });

  return kittyRenderer;
}
