/**
 * Effect runtime for the application.
 * Provides a managed runtime with all services composed.
 */
import { Effect, Layer, ManagedRuntime, Runtime } from "effect"
import { AppConfig, ThemeConfig } from "./Config"
import { Clipboard, FileSystem, Pty, SessionStorage, SessionManager } from "./services"

// =============================================================================
// Layer Composition
// =============================================================================

/** Base layer with configuration */
const ConfigLayer = Layer.merge(AppConfig.layer, ThemeConfig.layer)

/** I/O services layer */
const IoLayer = Layer.mergeAll(
  Clipboard.layer,
  FileSystem.layer
)

/** PTY layer (depends on Config) */
const PtyLayer = Pty.layer.pipe(Layer.provide(ConfigLayer))

/** Session layer (depends on FileSystem and Config) */
const SessionLayer = SessionStorage.layer.pipe(
  Layer.provide(Layer.merge(FileSystem.layer, ConfigLayer))
)

/** Session manager layer (depends on SessionStorage and Pty) */
const SessionManagerLayer = SessionManager.layer.pipe(
  Layer.provide(Layer.merge(SessionLayer, PtyLayer))
)

/** Full application layer */
export const AppLayer = Layer.mergeAll(
  ConfigLayer,
  IoLayer,
  PtyLayer,
  SessionLayer,
  SessionManagerLayer
)

/** Test layer composition */
const TestConfigLayer = Layer.merge(AppConfig.testLayer, ThemeConfig.testLayer)

const TestIoLayer = Layer.mergeAll(
  Clipboard.testLayer,
  FileSystem.testLayer
)

const TestPtyLayer = Pty.testLayer

const TestSessionLayer = SessionStorage.testLayer

const TestSessionManagerLayer = SessionManager.testLayer

export const TestAppLayer = Layer.mergeAll(
  TestConfigLayer,
  TestIoLayer,
  TestPtyLayer,
  TestSessionLayer,
  TestSessionManagerLayer
)

// =============================================================================
// Runtime Types
// =============================================================================

/** All services provided by the app layer */
export type AppServices =
  | AppConfig
  | ThemeConfig
  | Clipboard
  | FileSystem
  | Pty
  | SessionStorage
  | SessionManager

// =============================================================================
// Managed Runtime
// =============================================================================

/** Managed runtime for the application */
export const AppRuntime = ManagedRuntime.make(AppLayer)

/** Managed runtime for testing */
export const TestRuntime = ManagedRuntime.make(TestAppLayer)

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Run an effect with the app runtime.
 * Returns a promise that resolves with the result.
 */
export const runEffect = <A, E>(
  effect: Effect.Effect<A, E, AppServices>
): Promise<A> => AppRuntime.runPromise(effect)

/**
 * Run an effect with the app runtime, returning Exit.
 * Useful when you need to handle errors explicitly.
 */
export const runEffectExit = <A, E>(
  effect: Effect.Effect<A, E, AppServices>
) => AppRuntime.runPromiseExit(effect)

/**
 * Run an effect synchronously (for effects that don't suspend).
 * Use sparingly - prefer async where possible.
 */
export const runEffectSync = <A, E>(
  effect: Effect.Effect<A, E, AppServices>
): A => AppRuntime.runSync(effect)

/**
 * Run an effect and ignore errors (log them instead).
 * Useful for fire-and-forget operations.
 */
export const runEffectIgnore = <A, E>(
  effect: Effect.Effect<A, E, AppServices>
): Promise<void> =>
  AppRuntime.runPromise(
    effect.pipe(
      Effect.catchAll((error) =>
        Effect.logError("Effect failed", error).pipe(Effect.as(undefined as unknown as A))
      ),
      Effect.asVoid
    )
  )

// =============================================================================
// Runtime Lifecycle
// =============================================================================

/**
 * Dispose the app runtime.
 * Call this when shutting down the application.
 */
export const disposeRuntime = (): Promise<void> =>
  AppRuntime.dispose()
