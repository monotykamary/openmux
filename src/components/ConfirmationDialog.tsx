/**
 * ConfirmationDialog - modal overlay for confirming destructive actions
 */

import { Show, createSignal, createEffect, onCleanup } from 'solid-js';
import type { ConfirmationType } from '../core/types';
import { registerKeyboardHandler } from '../effect/bridge';

export type { ConfirmationType };

interface ConfirmationDialogProps {
  visible: boolean;
  type: ConfirmationType;
  width: number;
  height: number;
  onConfirm: () => void;
  onCancel: () => void;
}

const MESSAGES: Record<ConfirmationType, { title: string; message: string }> = {
  close_pane: {
    title: ' Close Pane ',
    message: 'Close this pane and terminate its process?',
  },
  exit: {
    title: ' Exit openmux ',
    message: 'Exit openmux? All panes and PTYs will be terminated.',
  },
};

export function ConfirmationDialog(props: ConfirmationDialogProps) {
  // Track which button is focused: 0 = Confirm, 1 = Cancel (default)
  const [focusedButton, setFocusedButton] = createSignal(1);

  // Reset to Cancel button when dialog opens
  createEffect(() => {
    if (props.visible) {
      setFocusedButton(1); // Default to Cancel
    }
  });

  // Handle keyboard input when dialog is open
  const handleKeyDown = (event: {
    key: string;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
  }) => {
    if (!props.visible) return false;

    const { key } = event;
    const normalizedKey = key.toLowerCase();

    switch (normalizedKey) {
      case 'escape':
        props.onCancel();
        return true;

      case 'return':
      case 'enter':
        // Execute the focused button's action
        if (focusedButton() === 0) {
          props.onConfirm();
        } else {
          props.onCancel();
        }
        return true;

      case 'left':
      case 'h':
        setFocusedButton(0); // Confirm
        return true;

      case 'right':
      case 'l':
      case 'tab':
        setFocusedButton(1); // Cancel
        return true;

      default:
        // Consume all keys while dialog is open
        return true;
    }
  };

  // Register keyboard handler with KeyboardRouter
  createEffect(() => {
    let unsubscribe: (() => void) | null = null;
    registerKeyboardHandler('confirmationDialog', handleKeyDown).then((unsub) => {
      unsubscribe = unsub;
    });
    onCleanup(() => {
      if (unsubscribe) unsubscribe();
    });
  });

  const config = () => MESSAGES[props.type];

  // Calculate overlay dimensions
  const overlayWidth = () => Math.min(56, props.width - 4);
  const overlayHeight = 6; // title line + message + separator + buttons + border (2)
  const overlayX = () => Math.floor((props.width - overlayWidth()) / 2);
  const overlayY = () => Math.floor((props.height - overlayHeight) / 2);

  // Button styling - using opentui-style selection colors
  const confirmFg = () => (focusedButton() === 0 ? '#FFFFFF' : '#888888');
  const confirmBg = () => (focusedButton() === 0 ? '#334455' : undefined);
  const cancelFg = () => (focusedButton() === 1 ? '#FFFFFF' : '#888888');
  const cancelBg = () => (focusedButton() === 1 ? '#334455' : undefined);

  // Calculate button positioning for right alignment
  const confirmLabel = ' Confirm ';
  const cancelLabel = ' Cancel ';
  const buttonGap = 2;
  const totalButtonWidth = confirmLabel.length + buttonGap + cancelLabel.length;
  const buttonPadding = () => overlayWidth() - 4 - totalButtonWidth; // 4 = border + padding

  return (
    <Show when={props.visible}>
      <box
        style={{
          position: 'absolute',
          left: overlayX(),
          top: overlayY(),
          width: overlayWidth(),
          height: overlayHeight,
          border: true,
          borderStyle: 'rounded',
          borderColor: '#FF6600',
          padding: 1,
        }}
        backgroundColor="#1a1a1a"
        title={config().title}
        titleAlignment="center"
      >
        <box style={{ flexDirection: 'column' }}>
          {/* Message */}
          <box style={{ height: 1 }}>
            <text fg="#CCCCCC">{config().message}</text>
          </box>

          {/* Separator */}
          <box style={{ height: 1 }}>
            <text fg="#444444">{'─'.repeat(overlayWidth() - 4)}</text>
          </box>

          {/* Buttons - right aligned: Confirm, Cancel */}
          <box style={{ flexDirection: 'row', height: 1 }}>
            {/* Spacer for right alignment */}
            <text>{' '.repeat(buttonPadding())}</text>
            <text fg={confirmFg()} bg={confirmBg()}>
              {confirmLabel}
            </text>
            <text>{' '.repeat(buttonGap)}</text>
            <text fg={cancelFg()} bg={cancelBg()}>
              {cancelLabel}
            </text>
          </box>
        </box>
      </box>
    </Show>
  );
}
