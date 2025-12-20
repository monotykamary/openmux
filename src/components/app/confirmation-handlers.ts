/**
 * Confirmation dialog handlers for App
 * Handles request, confirm, and cancel actions for various confirmation dialogs
 */

import type { ConfirmationType } from '../../core/types';
import type { Accessor, Setter } from 'solid-js';

export interface ConfirmationState {
  visible: boolean;
  type: ConfirmationType;
}

export interface ConfirmationHandlerDeps {
  // State
  confirmationState: Accessor<ConfirmationState>;
  setConfirmationState: Setter<ConfirmationState>;
  pendingKillPtyId: Accessor<string | null>;
  setPendingKillPtyId: Setter<string | null>;

  // Layout actions
  closePane: () => void;
  getFocusedPtyId: () => string | undefined;

  // Terminal actions
  destroyPTY: (ptyId: string, options?: { skipPaneClose?: boolean }) => void;

  // Keyboard state
  enterConfirmMode: (type: ConfirmationType) => void;
  exitConfirmMode: () => void;

  // Session actions
  saveSession: () => Promise<void>;

  // Renderer
  destroyRenderer: () => void;
}

/**
 * Create confirmation dialog handlers
 */
export function createConfirmationHandlers(deps: ConfirmationHandlerDeps) {
  const {
    confirmationState,
    setConfirmationState,
    pendingKillPtyId,
    setPendingKillPtyId,
    closePane,
    getFocusedPtyId,
    destroyPTY,
    enterConfirmMode,
    exitConfirmMode,
    saveSession,
    destroyRenderer,
  } = deps;

  /**
   * Request close pane (show confirmation)
   */
  const handleRequestClosePane = () => {
    enterConfirmMode('close_pane');
    setConfirmationState({ visible: true, type: 'close_pane' });
  };

  /**
   * Request quit (show confirmation)
   */
  const handleRequestQuit = () => {
    enterConfirmMode('exit');
    setConfirmationState({ visible: true, type: 'exit' });
  };

  /**
   * Request kill PTY (show confirmation) - from aggregate view
   */
  const handleRequestKillPty = (ptyId: string) => {
    setPendingKillPtyId(ptyId);
    enterConfirmMode('kill_pty');
    setConfirmationState({ visible: true, type: 'kill_pty' });
  };

  /**
   * Handle confirmation action
   */
  const handleConfirmAction = async () => {
    const { type } = confirmationState();
    exitConfirmMode();
    setConfirmationState({ visible: false, type: 'close_pane' });

    if (type === 'close_pane') {
      // Get the focused pane's PTY ID before closing (so we can destroy it)
      const ptyId = getFocusedPtyId();
      closePane();
      // Destroy the PTY to kill the terminal process
      // Defer to macrotask to avoid blocking animations
      // Pass skipPaneClose=true since we already closed the pane above
      if (ptyId) {
        setTimeout(() => {
          destroyPTY(ptyId, { skipPaneClose: true });
        }, 0);
      }
    } else if (type === 'exit') {
      await saveSession();
      destroyRenderer();
      process.exit(0);
    } else if (type === 'kill_pty') {
      // Kill PTY from aggregate view
      const ptyId = pendingKillPtyId();
      if (ptyId) {
        destroyPTY(ptyId);
        setPendingKillPtyId(null);
      }
    }
  };

  /**
   * Handle cancel confirmation
   */
  const handleCancelConfirmation = () => {
    exitConfirmMode();
    setConfirmationState({ visible: false, type: 'close_pane' });
    setPendingKillPtyId(null);
  };

  return {
    handleRequestClosePane,
    handleRequestQuit,
    handleRequestKillPty,
    handleConfirmAction,
    handleCancelConfirmation,
  };
}
