/**
 * App-specific handlers and utilities
 */

export {
  createConfirmationHandlers,
  type ConfirmationHandlerDeps,
  type ConfirmationState,
} from './confirmation-handlers';

export { createPaneResizeHandlers, type PaneResizeDeps } from './pane-resize';

export { createPasteHandler, type PasteHandlerDeps } from './paste-handler';

export { handleSearchKeyboard, type SearchKeyboardDeps } from './search-keyboard';

export { processNormalModeKey, type KeyProcessorDeps } from './key-processor';

export { useAppActions, type AppActionsDeps } from './app-actions';
