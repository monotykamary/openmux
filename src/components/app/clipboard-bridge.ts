import { onCleanup, onMount } from 'solid-js';

export function setupClipboardAndShimBridge(params: {
  setClipboardPasteHandler: (handler: (ptyId: string) => void) => void;
  readFromClipboard: () => Promise<string | null>;
  writeToPTY: (ptyId: string, data: string) => void | Promise<void>;
  onShimDetached: (handler: () => void) => () => void;
  handleShimDetached: () => void;
}) {
  const {
    setClipboardPasteHandler,
    readFromClipboard,
    writeToPTY,
    onShimDetached,
    handleShimDetached,
  } = params;

  onMount(() => {
    // Bracketed paste mode sequences
    const PASTE_START = '\x1b[200~';
    const PASTE_END = '\x1b[201~';

    // Register clipboard paste handler
    // This is called when paste start marker is detected in stdin
    // We read from clipboard (always complete, no chunking issues) instead of stdin data
    setClipboardPasteHandler(async (ptyId) => {
      try {
        // Read directly from system clipboard - always complete, no chunking issues
        const clipboardText = await readFromClipboard();
        if (!clipboardText) return;

        // Send complete paste atomically with brackets
        // Apps with bracketed paste mode expect the entire paste between markers
        const fullPaste = PASTE_START + clipboardText + PASTE_END;
        await Promise.resolve(writeToPTY(ptyId, fullPaste));
      } catch (err) {
        console.error('Clipboard paste error:', err);
      }
    });

    const unsubscribeDetached = onShimDetached(handleShimDetached);

    onCleanup(() => {
      unsubscribeDetached();
    });
  });
}
