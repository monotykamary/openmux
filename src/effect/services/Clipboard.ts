/**
 * Clipboard service for cross-platform clipboard operations.
 */
import { Context, Effect, Layer } from "effect"
import { ClipboardError } from "../errors"

// =============================================================================
// Clipboard Service
// =============================================================================

export class Clipboard extends Context.Tag("@openmux/Clipboard")<
  Clipboard,
  {
    /** Write text to the system clipboard */
    readonly write: (text: string) => Effect.Effect<void, ClipboardError>
    /** Read text from the system clipboard */
    readonly read: () => Effect.Effect<string, ClipboardError>
  }
>() {
  /** Production layer - uses platform-specific clipboard commands */
  static readonly layer = Layer.sync(Clipboard, () => {
    const platform = process.platform

    const write = (text: string): Effect.Effect<void, ClipboardError> =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: async () => {
            if (platform === "darwin") {
              const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" })
              proc.stdin.write(text)
              proc.stdin.end()
              await proc.exited
            } else if (platform === "linux") {
              // Try xclip first, fall back to xsel
              try {
                const proc = Bun.spawn(["xclip", "-selection", "clipboard"], {
                  stdin: "pipe",
                })
                proc.stdin.write(text)
                proc.stdin.end()
                await proc.exited
              } catch {
                const proc = Bun.spawn(["xsel", "--clipboard", "--input"], {
                  stdin: "pipe",
                })
                proc.stdin.write(text)
                proc.stdin.end()
                await proc.exited
              }
            } else if (platform === "win32") {
              const proc = Bun.spawn(["clip"], { stdin: "pipe" })
              proc.stdin.write(text)
              proc.stdin.end()
              await proc.exited
            }
          },
          catch: (error) =>
            ClipboardError.make({ operation: "write", cause: error }),
        })
      }).pipe(
        Effect.timeout("5 seconds"),
        Effect.catchTag("TimeoutException", () =>
          ClipboardError.make({
            operation: "write",
            cause: new Error("Clipboard write timed out"),
          })
        )
      )

    const read = (): Effect.Effect<string, ClipboardError> =>
      Effect.gen(function* () {
        return yield* Effect.tryPromise({
          try: async () => {
            if (platform === "darwin") {
              const result = await Bun.$`pbpaste`.quiet()
              return result.text()
            } else if (platform === "linux") {
              try {
                const result = await Bun.$`xclip -selection clipboard -o`.quiet()
                return result.text()
              } catch {
                const result = await Bun.$`xsel --clipboard --output`.quiet()
                return result.text()
              }
            } else if (platform === "win32") {
              const result = await Bun.$`powershell -command "Get-Clipboard"`.quiet()
              return result.text()
            }
            return ""
          },
          catch: (error) =>
            ClipboardError.make({ operation: "read", cause: error }),
        })
      }).pipe(
        Effect.timeout("5 seconds"),
        Effect.catchTag("TimeoutException", () =>
          ClipboardError.make({
            operation: "read",
            cause: new Error("Clipboard read timed out"),
          })
        )
      )

    return Clipboard.of({ write, read })
  })

  /** Test layer - in-memory clipboard for testing */
  static readonly testLayer = Layer.sync(Clipboard, () => {
    let buffer = ""

    const write = (text: string): Effect.Effect<void, ClipboardError> =>
      Effect.sync(() => {
        buffer = text
      })

    const read = (): Effect.Effect<string, ClipboardError> =>
      Effect.succeed(buffer)

    return Clipboard.of({ write, read })
  })
}
