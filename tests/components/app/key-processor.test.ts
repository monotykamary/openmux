/**
 * Tests for processNormalModeKey keyboard forwarding behavior.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { processNormalModeKey } from "../../../src/components/app/key-processor";
import { encodeKeyForEmulator } from "../../../src/terminal/key-encoder";

vi.mock("../../../src/terminal/key-encoder", () => ({
  encodeKeyForEmulator: vi.fn(),
}));

describe("processNormalModeKey", () => {
  const emulator = {} as object;
  const getFocusedEmulator = vi.fn(() => emulator);
  const writeToFocused = vi.fn();
  const clearAllSelections = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("clears selections and writes on press", () => {
    const encodeMock = vi.mocked(encodeKeyForEmulator);
    encodeMock.mockReturnValue("encoded");

    processNormalModeKey(
      { key: "a", sequence: "a", eventType: "press" },
      { clearAllSelections, getFocusedEmulator, writeToFocused }
    );

    expect(clearAllSelections).toHaveBeenCalledTimes(1);
    expect(encodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: "a", sequence: "a", eventType: "press" }),
      emulator
    );
    expect(writeToFocused).toHaveBeenCalledWith("encoded");
  });

  test("skips selection clear on release but still encodes", () => {
    const encodeMock = vi.mocked(encodeKeyForEmulator);
    encodeMock.mockReturnValue("encoded");

    processNormalModeKey(
      { key: "a", sequence: "a", eventType: "release" },
      { clearAllSelections, getFocusedEmulator, writeToFocused }
    );

    expect(clearAllSelections).not.toHaveBeenCalled();
    expect(encodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: "a", sequence: "a", eventType: "release" }),
      emulator
    );
    expect(writeToFocused).toHaveBeenCalledWith("encoded");
  });
});
