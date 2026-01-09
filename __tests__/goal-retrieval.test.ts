/**
 * Tests for goal retrieval functionality (readGoal/goal_get)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createMockPluginContext,
  createMockFileSystem,
  setupMockFileSystem,
} from "./goal-test-setup.js"
import { createGoalManagement } from "../index.js"

describe("GoalManagement - Goal Retrieval", () => {
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

  it("should retrieve an existing goal", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // Create a goal first
    await goalManagement.createGoal(
      "session-123",
      "Retrievable goal",
      "Goal can be retrieved"
    )

    // Retrieve the goal
    const goal = await goalManagement.readGoal("session-123")

    expect(goal).toBeDefined()
    expect(goal?.title).toBe("Retrievable goal")
    expect(goal?.done_condition).toBe("Goal can be retrieved")
  })

  it("should return null for non-existent goal", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const goal = await goalManagement.readGoal("non-existent-session")

    expect(goal).toBeNull()
  })

  it("should return null when goal file is corrupted", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // Mock readFile to return invalid JSON
    const fs = await import("node:fs/promises")
    vi.mocked(fs.readFile).mockResolvedValue("invalid json {")

    const goal = await goalManagement.readGoal("session-123")

    expect(goal).toBeNull()
  })

  it("should validate goal structure", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // Create a valid goal
    await goalManagement.createGoal("session-123", "Valid goal", "Done")

    const goal = await goalManagement.readGoal("session-123")

    expect(goal?.title).toBeTruthy()
    expect(goal?.done_condition).toBeTruthy()
    expect(goal?.created_at).toBeTruthy()
    expect(["active", "completed"]).toContain(goal?.status)
  })
})