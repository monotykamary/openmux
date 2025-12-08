/**
 * Application configuration service using Effect.Config.
 */
import { Config, Context, Effect, Layer } from "effect"

// =============================================================================
// Config Service
// =============================================================================

/** Application configuration */
export interface AppConfigShape {
  readonly windowGap: number
  readonly minPaneWidth: number
  readonly minPaneHeight: number
  readonly stackRatio: number
  readonly defaultShell: string
  readonly sessionStoragePath: string
}

export class AppConfig extends Context.Tag("@openmux/AppConfig")<
  AppConfig,
  AppConfigShape
>() {
  /** Production layer - reads from environment with sensible defaults */
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const home = yield* Config.string("HOME").pipe(
        Config.orElse(() => Config.string("USERPROFILE")),
        Config.orElse(() => Config.succeed("/tmp"))
      )

      const defaultShell = yield* Config.string("SHELL").pipe(
        Config.orElse(() => Config.succeed("/bin/bash"))
      )

      const windowGap = yield* Config.integer("OPENMUX_WINDOW_GAP").pipe(
        Config.orElse(() => Config.succeed(0))
      )

      const minPaneWidth = yield* Config.integer("OPENMUX_MIN_PANE_WIDTH").pipe(
        Config.orElse(() => Config.succeed(20))
      )

      const minPaneHeight = yield* Config.integer("OPENMUX_MIN_PANE_HEIGHT").pipe(
        Config.orElse(() => Config.succeed(5))
      )

      const stackRatio = yield* Config.number("OPENMUX_STACK_RATIO").pipe(
        Config.orElse(() => Config.succeed(0.5))
      )

      return AppConfig.of({
        windowGap,
        minPaneWidth,
        minPaneHeight,
        stackRatio,
        defaultShell,
        sessionStoragePath: `${home}/.config/openmux/sessions`,
      })
    })
  )

  /** Test layer - hardcoded values for testing */
  static readonly testLayer = Layer.succeed(AppConfig, {
    windowGap: 0,
    minPaneWidth: 20,
    minPaneHeight: 5,
    stackRatio: 0.5,
    defaultShell: "/bin/bash",
    sessionStoragePath: "/tmp/openmux-test/sessions",
  })
}

// =============================================================================
// Theme Configuration
// =============================================================================

/** Terminal color palette */
export interface TerminalColors {
  readonly foreground: string
  readonly background: string
  readonly cursor: string
  readonly selection: string
  readonly black: string
  readonly red: string
  readonly green: string
  readonly yellow: string
  readonly blue: string
  readonly magenta: string
  readonly cyan: string
  readonly white: string
  readonly brightBlack: string
  readonly brightRed: string
  readonly brightGreen: string
  readonly brightYellow: string
  readonly brightBlue: string
  readonly brightMagenta: string
  readonly brightCyan: string
  readonly brightWhite: string
}

/** Default terminal colors */
export const DEFAULT_COLORS: TerminalColors = {
  foreground: "#c0caf5",
  background: "#1a1b26",
  cursor: "#c0caf5",
  selection: "#33467c",
  black: "#15161e",
  red: "#f7768e",
  green: "#9ece6a",
  yellow: "#e0af68",
  blue: "#7aa2f7",
  magenta: "#bb9af7",
  cyan: "#7dcfff",
  white: "#a9b1d6",
  brightBlack: "#414868",
  brightRed: "#f7768e",
  brightGreen: "#9ece6a",
  brightYellow: "#e0af68",
  brightBlue: "#7aa2f7",
  brightMagenta: "#bb9af7",
  brightCyan: "#7dcfff",
  brightWhite: "#c0caf5",
}

export class ThemeConfig extends Context.Tag("@openmux/ThemeConfig")<
  ThemeConfig,
  {
    readonly colors: TerminalColors
    readonly borderStyle: "single" | "double" | "rounded"
    readonly focusedBorderColor: string
    readonly unfocusedBorderColor: string
  }
>() {
  static readonly layer = Layer.succeed(ThemeConfig, {
    colors: DEFAULT_COLORS,
    borderStyle: "rounded",
    focusedBorderColor: "#7aa2f7",
    unfocusedBorderColor: "#414868",
  })

  static readonly testLayer = Layer.succeed(ThemeConfig, {
    colors: DEFAULT_COLORS,
    borderStyle: "single",
    focusedBorderColor: "#ffffff",
    unfocusedBorderColor: "#888888",
  })
}
