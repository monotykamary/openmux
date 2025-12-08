/**
 * FileSystem service for file I/O operations with schema validation.
 */
import { Context, Effect, Layer, Schema } from "effect"
import { SessionStorageError } from "../errors"

// =============================================================================
// FileSystem Service
// =============================================================================

export class FileSystem extends Context.Tag("@openmux/FileSystem")<
  FileSystem,
  {
    /** Read and validate JSON from a file */
    readonly readJson: <A, I>(
      path: string,
      schema: Schema.Schema<A, I>
    ) => Effect.Effect<A, SessionStorageError>

    /** Encode and write JSON to a file */
    readonly writeJson: <A, I>(
      path: string,
      schema: Schema.Schema<A, I>,
      data: A
    ) => Effect.Effect<void, SessionStorageError>

    /** Check if a file exists */
    readonly exists: (path: string) => Effect.Effect<boolean>

    /** Ensure a directory exists (creates recursively if needed) */
    readonly ensureDir: (path: string) => Effect.Effect<void, SessionStorageError>

    /** Delete a file */
    readonly remove: (path: string) => Effect.Effect<void, SessionStorageError>

    /** List files in a directory */
    readonly list: (path: string) => Effect.Effect<string[], SessionStorageError>

    /** Read raw text from a file */
    readonly readText: (path: string) => Effect.Effect<string, SessionStorageError>

    /** Write raw text to a file */
    readonly writeText: (
      path: string,
      content: string
    ) => Effect.Effect<void, SessionStorageError>
  }
>() {
  /** Production layer - uses Bun file APIs */
  static readonly layer = Layer.sync(FileSystem, () => {
    const readJson = <A, I>(
      path: string,
      schema: Schema.Schema<A, I>
    ): Effect.Effect<A, SessionStorageError> =>
      Effect.gen(function* () {
        const file = Bun.file(path)
        const fileExists = yield* Effect.promise(() => file.exists())

        if (!fileExists) {
          return yield* SessionStorageError.make({
            operation: "read",
            path,
            cause: new Error("File not found"),
          })
        }

        const content = yield* Effect.tryPromise({
          try: () => file.text(),
          catch: (error) =>
            SessionStorageError.make({ operation: "read", path, cause: error }),
        })

        const parsed = yield* Effect.try({
          try: () => JSON.parse(content),
          catch: (error) =>
            SessionStorageError.make({ operation: "read", path, cause: error }),
        })

        return yield* Schema.decodeUnknown(schema)(parsed).pipe(
          Effect.mapError((error) =>
            SessionStorageError.make({ operation: "read", path, cause: error })
          )
        )
      })

    const writeJson = <A, I>(
      path: string,
      schema: Schema.Schema<A, I>,
      data: A
    ): Effect.Effect<void, SessionStorageError> =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encode(schema)(data).pipe(
          Effect.mapError((error) =>
            SessionStorageError.make({ operation: "write", path, cause: error })
          )
        )

        yield* Effect.tryPromise({
          try: () => Bun.write(path, JSON.stringify(encoded, null, 2)),
          catch: (error) =>
            SessionStorageError.make({ operation: "write", path, cause: error }),
        })
      })

    const exists = (path: string): Effect.Effect<boolean> =>
      Effect.promise(() => Bun.file(path).exists())

    const ensureDir = (path: string): Effect.Effect<void, SessionStorageError> =>
      Effect.tryPromise({
        try: async () => {
          await Bun.$`mkdir -p ${path}`.quiet()
        },
        catch: (error) =>
          SessionStorageError.make({ operation: "write", path, cause: error }),
      })

    const remove = (path: string): Effect.Effect<void, SessionStorageError> =>
      Effect.tryPromise({
        try: async () => {
          const file = Bun.file(path)
          if (await file.exists()) {
            await Bun.$`rm ${path}`.quiet()
          }
        },
        catch: (error) =>
          SessionStorageError.make({ operation: "delete", path, cause: error }),
      })

    const list = (path: string): Effect.Effect<string[], SessionStorageError> =>
      Effect.tryPromise({
        try: async () => {
          const glob = new Bun.Glob("*")
          const files: string[] = []
          for await (const file of glob.scan(path)) {
            files.push(file)
          }
          return files
        },
        catch: (error) =>
          SessionStorageError.make({ operation: "read", path, cause: error }),
      })

    const readText = (path: string): Effect.Effect<string, SessionStorageError> =>
      Effect.tryPromise({
        try: async () => {
          const file = Bun.file(path)
          if (!(await file.exists())) {
            throw new Error("File not found")
          }
          return file.text()
        },
        catch: (error) =>
          SessionStorageError.make({ operation: "read", path, cause: error }),
      })

    const writeText = (
      path: string,
      content: string
    ): Effect.Effect<void, SessionStorageError> =>
      Effect.tryPromise({
        try: () => Bun.write(path, content),
        catch: (error) =>
          SessionStorageError.make({ operation: "write", path, cause: error }),
      })

    return FileSystem.of({
      readJson,
      writeJson,
      exists,
      ensureDir,
      remove,
      list,
      readText,
      writeText,
    })
  })

  /** Test layer - in-memory file system for testing */
  static readonly testLayer = Layer.sync(FileSystem, () => {
    const files = new Map<string, string>()
    const directories = new Set<string>()

    const readJson = <A, I>(
      path: string,
      schema: Schema.Schema<A, I>
    ): Effect.Effect<A, SessionStorageError> =>
      Effect.gen(function* () {
        const content = files.get(path)
        if (content === undefined) {
          return yield* SessionStorageError.make({
            operation: "read",
            path,
            cause: new Error("File not found"),
          })
        }

        const parsed = yield* Effect.try({
          try: () => JSON.parse(content),
          catch: (error) =>
            SessionStorageError.make({ operation: "read", path, cause: error }),
        })

        return yield* Schema.decodeUnknown(schema)(parsed).pipe(
          Effect.mapError((error) =>
            SessionStorageError.make({ operation: "read", path, cause: error })
          )
        )
      })

    const writeJson = <A, I>(
      path: string,
      schema: Schema.Schema<A, I>,
      data: A
    ): Effect.Effect<void, SessionStorageError> =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encode(schema)(data).pipe(
          Effect.mapError((error) =>
            SessionStorageError.make({ operation: "write", path, cause: error })
          )
        )
        files.set(path, JSON.stringify(encoded, null, 2))
      })

    const exists = (path: string): Effect.Effect<boolean> =>
      Effect.succeed(files.has(path) || directories.has(path))

    const ensureDir = (path: string): Effect.Effect<void, SessionStorageError> =>
      Effect.sync(() => {
        directories.add(path)
      })

    const remove = (path: string): Effect.Effect<void, SessionStorageError> =>
      Effect.sync(() => {
        files.delete(path)
      })

    const list = (path: string): Effect.Effect<string[], SessionStorageError> =>
      Effect.succeed(
        Array.from(files.keys())
          .filter((f) => f.startsWith(path))
          .map((f) => f.slice(path.length + 1))
      )

    const readText = (path: string): Effect.Effect<string, SessionStorageError> =>
      Effect.gen(function* () {
        const content = files.get(path)
        if (content === undefined) {
          return yield* SessionStorageError.make({
            operation: "read",
            path,
            cause: new Error("File not found"),
          })
        }
        return content
      })

    const writeText = (
      path: string,
      content: string
    ): Effect.Effect<void, SessionStorageError> =>
      Effect.sync(() => {
        files.set(path, content)
      })

    return FileSystem.of({
      readJson,
      writeJson,
      exists,
      ensureDir,
      remove,
      list,
      readText,
      writeText,
    })
  })
}
