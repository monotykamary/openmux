/**
 * TemplateStorage service for layout template persistence.
 */
import { Context, Effect, Layer } from "effect"
import type { SessionStorageError } from "../errors"
import { AppConfig } from "../Config"
import { FileSystem } from "./FileSystem"
import { TemplateSession } from "../models"

// =============================================================================
// TemplateStorage Service
// =============================================================================

export class TemplateStorage extends Context.Tag("@openmux/TemplateStorage")<
  TemplateStorage,
  {
    readonly listTemplates: () => Effect.Effect<TemplateSession[], SessionStorageError>
    readonly loadTemplate: (id: string) => Effect.Effect<TemplateSession, SessionStorageError>
    readonly saveTemplate: (template: TemplateSession) => Effect.Effect<void, SessionStorageError>
    readonly deleteTemplate: (id: string) => Effect.Effect<void, SessionStorageError>
  }
>() {
  static readonly layer = Layer.effect(
    TemplateStorage,
    Effect.gen(function* () {
      const config = yield* AppConfig
      const fs = yield* FileSystem
      const storagePath = config.templateStoragePath

      const templatePath = (id: string) => `${storagePath}/${id}.json`

      const listTemplates = Effect.fn("TemplateStorage.listTemplates")(function* () {
        yield* fs.ensureDir(storagePath)
        const files = yield* fs.list(storagePath)
        const templates: TemplateSession[] = []

        for (const file of files) {
          if (!file.endsWith(".json")) continue
          const path = `${storagePath}/${file}`
          const template = yield* fs.readJson(path, TemplateSession).pipe(
            Effect.catchAll(() => Effect.succeed(null))
          )
          if (template) {
            templates.push(template)
          }
        }

        templates.sort((a, b) => a.name.localeCompare(b.name))
        return templates
      })

      const loadTemplate = Effect.fn("TemplateStorage.loadTemplate")(function* (id: string) {
        yield* fs.ensureDir(storagePath)
        return yield* fs.readJson(templatePath(id), TemplateSession)
      })

      const saveTemplate = Effect.fn("TemplateStorage.saveTemplate")(function* (
        template: TemplateSession
      ) {
        yield* fs.ensureDir(storagePath)
        yield* fs.writeJson(templatePath(template.id), TemplateSession, template)
      })

      const deleteTemplate = Effect.fn("TemplateStorage.deleteTemplate")(function* (id: string) {
        yield* fs.ensureDir(storagePath)
        yield* fs.remove(templatePath(id))
      })

      return TemplateStorage.of({
        listTemplates,
        loadTemplate,
        saveTemplate,
        deleteTemplate,
      })
    })
  )

  static readonly testLayer = Layer.effect(
    TemplateStorage,
    Effect.gen(function* () {
      const config = yield* AppConfig
      const fs = yield* FileSystem
      const storagePath = config.templateStoragePath

      const templatePath = (id: string) => `${storagePath}/${id}.json`

      const listTemplates = Effect.fn("TemplateStorage.listTemplates")(function* () {
        yield* fs.ensureDir(storagePath)
        const files = yield* fs.list(storagePath)
        const templates: TemplateSession[] = []

        for (const file of files) {
          if (!file.endsWith(".json")) continue
          const path = `${storagePath}/${file}`
          const template = yield* fs.readJson(path, TemplateSession).pipe(
            Effect.catchAll(() => Effect.succeed(null))
          )
          if (template) {
            templates.push(template)
          }
        }

        templates.sort((a, b) => a.name.localeCompare(b.name))
        return templates
      })

      const loadTemplate = Effect.fn("TemplateStorage.loadTemplate")(function* (id: string) {
        yield* fs.ensureDir(storagePath)
        return yield* fs.readJson(templatePath(id), TemplateSession)
      })

      const saveTemplate = Effect.fn("TemplateStorage.saveTemplate")(function* (
        template: TemplateSession
      ) {
        yield* fs.ensureDir(storagePath)
        yield* fs.writeJson(templatePath(template.id), TemplateSession, template)
      })

      const deleteTemplate = Effect.fn("TemplateStorage.deleteTemplate")(function* (id: string) {
        yield* fs.ensureDir(storagePath)
        yield* fs.remove(templatePath(id))
      })

      return TemplateStorage.of({
        listTemplates,
        loadTemplate,
        saveTemplate,
        deleteTemplate,
      })
    })
  )
}
