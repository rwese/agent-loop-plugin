/**
 * Tests for goal creation functionality (createGoal/goal_set)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createMockPluginContext,
  createMockFileSystem,
  setupMockFileSystem,
} from "./goal-test-setup.js"
import { createGoalManagement } from "../index.js"

describe("GoalManagement - Goal Creation", () => {
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

  it("should create a new goal with active status", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const goal = await goalManagement.createGoal(
      "session-123",
      "Complete the project setup",
      "All setup tasks are done"
    )

    expect(goal).toBeDefined()
    expect(goal.title).toBe("Complete the project setup")
    expect(goal.done_condition).toBe("All setup tasks are done")
    expect(goal.status).toBe("active")
    expect(goal.created_at).toBeDefined()
    expect(goal.completed_at).toBeNull()
  })

  it("should create a goal with optional description", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const goal = await goalManagement.createGoal(
      "session-123",
      "Build the feature",
      "Feature is deployed to production",
      "This is a detailed description of the goal"
    )

    expect(goal.description).toBe("This is a detailed description of the goal")
    expect(goal.title).toBe("Build the feature")
  })

  it("should generate goal with ISO timestamp", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const goal = await goalManagement.createGoal(
      "session-123",
      "Test goal",
      "Test is passing"
    )

    // Verify timestamp is valid ISO format
    const timestamp = new Date(goal.created_at)
    expect(timestamp.toISOString()).toBe(goal.created_at)
    expect(timestamp.getTime()).toBeGreaterThan(0)
  })

  it("should store goal in file system", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    await goalManagement.createGoal(
      "session-123",
      "Store this goal",
      "Goal is stored"
    )

    // Verify writeFile was called
    const fs = await import("node:fs/promises")
    expect(fs.writeFile).toHaveBeenCalled()
    expect(fs.mkdir).toHaveBeenCalled()
  })

  it("should return the created goal", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const goal = await goalManagement.createGoal(
      "session-123",
      "Returnable goal",
      "Goal can be returned"
    )

    expect(goal).toHaveProperty("title")
    expect(goal).toHaveProperty("done_condition")
    expect(goal).toHaveProperty("status")
    expect(goal).toHaveProperty("created_at")
    expect(goal).toHaveProperty("completed_at")
  })
})