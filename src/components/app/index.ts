/**
 * App-specific handlers and utilities
 */

export {
  createConfirmationHandlers,
  type ConfirmationHandlerDeps,
  type ConfirmationState,
} from './confirmation-handlers';

export {
  createPaneResizeHandlers,
  type PaneResizeDeps,
} from './pane-resize';

export {
  createPasteHandler,
  type PasteHandlerDeps,
} from './paste-handler';

export {
  createActionHandlers,
  type ActionHandlersDeps,
  type ActionHandlers,
} from './action-handlers';

export {
  handleSearchKeyboard,
  type SearchKeyboardDeps,
  type KeyEvent,
} from './search-keyboard';

export {
  processNormalModeKey,
  type KeyProcessorDeps,
} from './key-processor';
