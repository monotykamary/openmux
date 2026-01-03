import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { sendPtyFocusEvent } from '../../effect/bridge';
import { setFocusedPty } from '../../terminal/focused-pty-registry';
import { setHostFocusState } from '../../terminal/host-focus';

const FOCUS_IN_SEQUENCE = '\x1b[I';
const FOCUS_OUT_SEQUENCE = '\x1b[O';

export function setupFocusedPtyRegistry(getFocusedPtyId: () => string | null | undefined): void {
  createEffect(() => {
    setFocusedPty(getFocusedPtyId() ?? null);
  });
}

export function setupHostFocusTracking(params: {
  renderer: unknown;
  isPtyActive: (ptyId: string) => boolean;
  getFocusedPtyId: () => string | null | undefined;
}): void {
  const { renderer, isPtyActive, getFocusedPtyId } = params;
  const [isHostFocused, setIsHostFocused] = createSignal<boolean | null>(null);

  const sendFocusEvent = (ptyId: string, focused: boolean) => {
    if (!isPtyActive(ptyId)) return;
    void sendPtyFocusEvent(ptyId, focused);
  };

  onMount(() => {
    let focusBuffer = '';
    const maxFocusBuffer = 8;

    const handleFocusSequence = (sequence: string) => {
      if (!sequence) return false;

      if (sequence === FOCUS_IN_SEQUENCE) {
        setIsHostFocused(true);
        return true;
      }
      if (sequence === FOCUS_OUT_SEQUENCE) {
        setIsHostFocused(false);
        return true;
      }

      focusBuffer = `${focusBuffer}${sequence}`;
      const lastIn = focusBuffer.lastIndexOf(FOCUS_IN_SEQUENCE);
      const lastOut = focusBuffer.lastIndexOf(FOCUS_OUT_SEQUENCE);

      if (lastIn !== -1 || lastOut !== -1) {
        setIsHostFocused(lastIn > lastOut);
        focusBuffer = focusBuffer.slice(-2);
        return false;
      }

      if (focusBuffer.length > maxFocusBuffer) {
        focusBuffer = focusBuffer.slice(-maxFocusBuffer);
      }

      return false;
    };

    const rendererAny = renderer as any;
    if (typeof rendererAny.prependInputHandler === 'function') {
      rendererAny.prependInputHandler(handleFocusSequence);
    }

    onCleanup(() => {
      if (typeof rendererAny.removeInputHandler === 'function') {
        rendererAny.removeInputHandler(handleFocusSequence);
      }
    });
  });

  let lastEffectiveFocusedPtyId: string | undefined;
  createEffect(() => {
    const focusedPtyId = getFocusedPtyId();
    const hostFocused = isHostFocused();
    setHostFocusState(hostFocused);
    if (hostFocused === null) {
      return;
    }

    const effectiveFocusedPtyId = hostFocused ? focusedPtyId ?? undefined : undefined;

    if (effectiveFocusedPtyId === lastEffectiveFocusedPtyId) {
      return;
    }

    if (lastEffectiveFocusedPtyId) {
      sendFocusEvent(lastEffectiveFocusedPtyId, false);
    }
    if (effectiveFocusedPtyId) {
      sendFocusEvent(effectiveFocusedPtyId, true);
    }

    lastEffectiveFocusedPtyId = effectiveFocusedPtyId;
  });
}
