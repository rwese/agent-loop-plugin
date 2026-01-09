/**
 * Tests for goal overwrite behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createMockPluginContext,
  createMockFileSystem,
  setupMockFileSystem,
} from "./goal-test-setup.js"
import { createGoalManagement } from "../index.js"

describe("GoalManagement - Goal Overwrite Behavior", () => {
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

  it("should overwrite existing goal with new goal_set", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // Create first goal
    await goalManagement.createGoal(
      "session-123",
      "First goal",
      "First goal is done"
    )

    // Overwrite with second goal
    const secondGoal = await goalManagement.createGoal(
      "session-123",
      "Second goal",
      "Second goal is done"
    )

    // Verify only second goal exists
    const currentGoal = await goalManagement.readGoal("session-123")

    expect(currentGoal?.title).toBe("Second goal")
    expect(secondGoal.title).toBe("Second goal")
  })

  it("should preserve completed_at when overwriting active goal", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // Create first goal and complete it
    await goalManagement.createGoal("session-123", "First", "Done")
    await goalManagement.completeGoal("session-123")

    // Create new goal (should overwrite)
    const newGoal = await goalManagement.createGoal("session-123", "Second", "Done")

    expect(newGoal.status).toBe("active")
    expect(newGoal.completed_at).toBeNull()
  })

  it("should handle multiple session goals independently", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // Create goals for different sessions with unique data
    await goalManagement.createGoal("session-1", "Goal for session 1", "Done 1")
    await goalManagement.createGoal("session-2", "Goal for session 2", "Done 2")

    // Verify each session has its own goal by checking write calls
    const session1Writes = mockFsContext.writeCalls.filter(call => 
      call[0].includes("session-1")
    )
    const session2Writes = mockFsContext.writeCalls.filter(call => 
      call[0].includes("session-2")
    )

    expect(session1Writes.length).toBeGreaterThan(0)
    expect(session2Writes.length).toBeGreaterThan(0)
  })
})