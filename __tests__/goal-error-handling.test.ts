/**
 * Tests for error handling in goal management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createMockPluginContext,
  createMockFileSystem,
  setupMockFileSystem,
} from "./goal-test-setup.js"
import { createGoalManagement } from "../index.js"

describe("GoalManagement - Error Handling", () => {
  let mockFsContext: ReturnType<typeof createMockFileSystem>
  let mockContext: ReturnType<typeof createMockPluginContext>

  beforeEach(() => {
    vi.useFakeTimers()
    mockFsContext = createMockFileSystem()
    setupMockFileSystem(mockFsContext)
    mockContext = createMockPluginContext()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("should return null when completing non-existent goal", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const result = await goalManagement.completeGoal("non-existent")

    expect(result).toBeNull()
  })

  it("should handle read errors gracefully", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // Mock readFile to throw a non-ENOENT error
    const fs = await import("node:fs/promises")
    vi.mocked(fs.readFile).mockRejectedValue(new Error("Permission denied"))

    const goal = await goalManagement.readGoal("session-123")

    expect(goal).toBeNull()
  })

  it("should handle write errors gracefully", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // Mock writeFile to throw an error
    const fs = await import("node:fs/promises")
    vi.mocked(fs.writeFile).mockRejectedValue(new Error("Write failed"))

    await expect(
      goalManagement.createGoal("session-123", "Test goal", "Done")
    ).rejects.toThrow()
  })

  it("should handle directory creation errors", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // Mock mkdir to throw an error
    const fs = await import("node:fs/promises")
    vi.mocked(fs.mkdir).mockRejectedValue(new Error("Directory creation failed"))

    await expect(
      goalManagement.createGoal("session-123", "Test goal", "Done")
    ).rejects.toThrow()
  })
})