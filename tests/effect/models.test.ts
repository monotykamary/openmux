/**
 * Tests for Effect domain models and schemas.
 */
import { Schema } from "effect"
import { describe, expect, it } from "@effect/vitest"
import {
  PaneId,
  PtyId,
  WorkspaceId,
  SessionId,
  Cols,
  Rows,
  LayoutMode,
} from "../../src/effect/types"
import {
  Rectangle,
  PaneData,
  SerializedSession,
  SessionIndex,
} from "../../src/effect/models"

describe("Branded Types", () => {
  describe("WorkspaceId", () => {
    it("accepts valid workspace IDs (1-9)", () => {
      expect(Schema.decodeUnknownSync(WorkspaceId)(1)).toBe(1)
      expect(Schema.decodeUnknownSync(WorkspaceId)(5)).toBe(5)
      expect(Schema.decodeUnknownSync(WorkspaceId)(9)).toBe(9)
    })

    it("rejects invalid workspace IDs", () => {
      expect(() => Schema.decodeUnknownSync(WorkspaceId)(0)).toThrow()
      expect(() => Schema.decodeUnknownSync(WorkspaceId)(10)).toThrow()
      expect(() => Schema.decodeUnknownSync(WorkspaceId)(-1)).toThrow()
    })
  })

  describe("Cols and Rows", () => {
    it("accepts positive integers", () => {
      expect(Schema.decodeUnknownSync(Cols)(80)).toBe(80)
      expect(Schema.decodeUnknownSync(Rows)(24)).toBe(24)
    })

    it("rejects zero and negative values", () => {
      expect(() => Schema.decodeUnknownSync(Cols)(0)).toThrow()
      expect(() => Schema.decodeUnknownSync(Rows)(-1)).toThrow()
    })
  })

  describe("LayoutMode", () => {
    it("accepts valid layout modes", () => {
      expect(Schema.decodeUnknownSync(LayoutMode)("vertical")).toBe("vertical")
      expect(Schema.decodeUnknownSync(LayoutMode)("horizontal")).toBe("horizontal")
      expect(Schema.decodeUnknownSync(LayoutMode)("stacked")).toBe("stacked")
    })

    it("rejects invalid layout modes", () => {
      expect(() => Schema.decodeUnknownSync(LayoutMode)("invalid")).toThrow()
    })
  })
})

describe("Domain Models", () => {
  describe("Rectangle", () => {
    it("creates valid rectangles", () => {
      const rect = Rectangle.make({ x: 0, y: 0, width: 100, height: 50 })
      expect(rect.x).toBe(0)
      expect(rect.y).toBe(0)
      expect(rect.width).toBe(100)
      expect(rect.height).toBe(50)
    })

    it("contains method works correctly", () => {
      const rect = Rectangle.make({ x: 10, y: 10, width: 100, height: 50 })
      expect(rect.contains(50, 30)).toBe(true)
      expect(rect.contains(10, 10)).toBe(true)
      expect(rect.contains(5, 5)).toBe(false)
      expect(rect.contains(110, 60)).toBe(false)
    })

    it("rejects invalid dimensions", () => {
      expect(() =>
        Rectangle.make({ x: 0, y: 0, width: 0, height: 50 })
      ).toThrow()
      expect(() =>
        Rectangle.make({ x: 0, y: 0, width: 100, height: -1 })
      ).toThrow()
    })
  })

  describe("SessionIndex", () => {
    it("creates empty session index", () => {
      const index = SessionIndex.empty()
      expect(index.sessions).toEqual([])
      expect(index.activeSessionId).toBeNull()
    })
  })
})

describe("Schema Encoding/Decoding", () => {
  describe("SerializedSession", () => {
    it("decodes valid session JSON", () => {
      const json = {
        id: "session-123",
        name: "Test Session",
        workspaces: [],
        activeWorkspaceId: 1,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      }

      const session = Schema.decodeUnknownSync(SerializedSession)(json)
      expect(session.id).toBe("session-123")
      expect(session.name).toBe("Test Session")
      expect(session.workspaces).toEqual([])
      expect(session.activeWorkspaceId).toBe(1)
      expect(session.createdAt).toBeInstanceOf(Date)
    })

    it("rejects invalid session JSON", () => {
      const json = { id: "session-123" } // Missing required fields
      expect(() =>
        Schema.decodeUnknownSync(SerializedSession)(json)
      ).toThrow()
    })
  })
})
