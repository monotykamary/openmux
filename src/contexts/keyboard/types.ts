/**
 * Types for keyboard context
 */

import type { KeyboardState, ConfirmationType, SplitDirection } from '../../core/types';

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
}

export interface KeyboardHandlerOptions {
  onPaste?: () => void;
  onNewPane?: () => void;
  onSplitPane?: (direction: SplitDirection) => void;
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
