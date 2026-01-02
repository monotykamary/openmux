export function createExitHandlers(params: {
  saveSession: () => Promise<void>;
  suspendSessionPersistence: () => void;
  shutdownShim: () => Promise<void>;
  disposeRuntime: () => Promise<void>;
  renderer: { destroy: () => void };
}) {
  const { saveSession, suspendSessionPersistence, shutdownShim, disposeRuntime, renderer } = params;
  let detaching = false;

  const handleQuit = async () => {
    if (detaching) return;
    detaching = true;
    await saveSession();
    suspendSessionPersistence();
    await shutdownShim();
    await disposeRuntime();
    renderer.destroy();
    process.exit(0);
  };

  const handleDetach = async () => {
    if (detaching) return;
    detaching = true;
    await saveSession();
    suspendSessionPersistence();
    await disposeRuntime();
    renderer.destroy();
    process.exit(0);
  };

  const handleShimDetached = () => {
    if (detaching) return;
    detaching = true;
    renderer.destroy();
    process.exit(0);
  };

  return {
    handleQuit,
    handleDetach,
    handleShimDetached,
  };
}
