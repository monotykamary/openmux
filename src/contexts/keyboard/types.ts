/**
 * Types for keyboard context
 */

import type { KeyboardState, ConfirmationType } from '../../core/types';

export interface KeyboardContextValue {
  state: KeyboardState;
  enterPrefixMode: () => void;
  exitPrefixMode: () => void;
  enterSearchMode: () => void;
  exitSearchMode: () => void;
  enterAggregateMode: () => void;
  exitAggregateMode: () => void;
  enterMoveMode: () => void;
  exitMoveMode: () => void;
  enterConfirmMode: (confirmationType: ConfirmationType) => void;
  exitConfirmMode: () => void;
  toggleHints: () => void;
}

export interface KeyboardHandlerOptions {
  onPaste?: () => void;
  onNewPane?: () => void;
  onQuit?: () => void;
  onDetach?: () => void;
  onRequestQuit?: () => void;
  onRequestClosePane?: () => void;
  onToggleSessionPicker?: () => void;
  onToggleTemplateOverlay?: () => void;
  onEnterSearch?: () => void;
  onToggleConsole?: () => void;
  onToggleAggregateView?: () => void;
  onToggleCommandPalette?: () => void;
}
