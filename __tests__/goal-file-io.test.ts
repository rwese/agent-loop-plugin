/**
 * Tests for file I/O operations in goal management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createMockPluginContext,
  createMockFileSystem,
  setupMockFileSystem,
} from "./goal-test-setup.js"
import { createGoalManagement } from "../index.js"
import type { Goal } from "../types.js"

describe("GoalManagement - File I/O Operations", () => {
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

  it("should use correct file path for goal storage", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    await goalManagement.createGoal("session-123", "Path test", "Done")

    // Verify the correct path was used
    const fs = await import("node:fs/promises")
    expect(fs.mkdir).toHaveBeenCalledWith(
      "/test/directory/.goals/session-123",
      { recursive: true }
    )
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/test/directory/.goals/session-123/goal.json",
      expect.any(String),
      "utf-8"
    )
  })

  it("should create directory structure recursively", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    await goalManagement.createGoal("new-session", "Recursive test", "Done")

    const fs = await import("node:fs/promises")
    expect(fs.mkdir).toHaveBeenCalled()
  })

  it("should serialize goal to JSON format", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // Reset write calls for this test
    mockFsContext.writeCalls = []

    const testTitle = "JSON serialization test"
    const testCondition = "JSON format validation"
    
    await goalManagement.createGoal("session-123", testTitle, testCondition)

    // Verify writeFile was called with valid JSON
    const lastWriteCall = mockFsContext.writeCalls[mockFsContext.writeCalls.length - 1]
    const writtenData = JSON.parse(lastWriteCall[1])

    expect(writtenData.title).toBe(testTitle)
    expect(writtenData.done_condition).toBe(testCondition)
    expect(writtenData.status).toBe("active")
  })

  it("should deserialize goal from JSON format", async () => {
    const storedGoal: Goal = {
      title: "Stored goal",
      done_condition: "Goal is stored",
      status: "active",
      created_at: new Date().toISOString(),
      completed_at: null,
    }

    // Set the stored goal and re-setup mocks for proper read behavior
    mockFsContext.storedGoal = storedGoal
    setupMockFileSystem(mockFsContext)

    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const goal = await goalManagement.readGoal("session-123")

    expect(goal?.title).toBe("Stored goal")
  })
})