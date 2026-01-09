/**
 * Tests for goal completion functionality (completeGoal/goal_done)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createMockPluginContext,
  createMockFileSystem,
  setupMockFileSystem,
} from "./goal-test-setup.js"
import { createGoalManagement } from "../index.js"

describe("GoalManagement - Goal Completion", () => {
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

  it("should mark a goal as completed", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // First create a goal
    await goalManagement.createGoal(
      "session-123",
      "Complete this goal",
      "Goal is done"
    )

    // Then complete it
    const completedGoal = await goalManagement.completeGoal("session-123")

    expect(completedGoal).toBeDefined()
    expect(completedGoal?.status).toBe("completed")
    expect(completedGoal?.completed_at).toBeDefined()
  })

  it("should update goal storage when completing", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // Reset write call counter for this specific test
    mockFsContext.writeCalls = []

    // Create and complete goal
    await goalManagement.createGoal("session-123", "Storage test", "Done")
    await goalManagement.completeGoal("session-123")

    // Verify writeFile was called for both operations
    const writeCallsForSession = mockFsContext.writeCalls.filter(
      call => call[0].includes("session-123")
    )
    expect(writeCallsForSession.length).toBeGreaterThanOrEqual(2)
  })

  it("should return null when completing non-existent goal", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const result = await goalManagement.completeGoal("non-existent-session")

    expect(result).toBeNull()
  })

  it("should set completed_at timestamp", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // Create a goal
    await goalManagement.createGoal("session-123", "Timestamp test", "Done")

    // Get the goal before completion
    const beforeComplete = await goalManagement.readGoal("session-123")

    // Complete the goal
    await goalManagement.completeGoal("session-123")

    // Get the goal after completion
    const afterComplete = await goalManagement.readGoal("session-123")

    expect(beforeComplete?.completed_at).toBeNull()
    expect(afterComplete?.completed_at).toBeDefined()
    expect(afterComplete?.completed_at).not.toBeNull()
  })
})