/**
 * Integration tests for goal management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createMockPluginContext,
  createMockFileSystem,
  setupMockFileSystem,
} from "./goal-test-setup.js"
import { createGoalManagement } from "../index.js"

describe("GoalManagement - Integration Tests", () => {
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

  it("should complete full goal lifecycle", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // 1. Create a goal
    const createdGoal = await goalManagement.createGoal(
      "session-123",
      "Lifecycle test",
      "All tests pass"
    )
    expect(createdGoal.status).toBe("active")
    expect(createdGoal.completed_at).toBeNull()

    // 2. Verify goal exists
    const existingGoal = await goalManagement.readGoal("session-123")
    expect(existingGoal).toBeDefined()
    expect(existingGoal?.title).toBe("Lifecycle test")

    // 3. Verify has active goal
    const hasActive = await goalManagement.hasActiveGoal("session-123")
    expect(hasActive).toBe(true)

    // 4. Complete the goal
    const completedGoal = await goalManagement.completeGoal("session-123")
    expect(completedGoal?.status).toBe("completed")
    expect(completedGoal?.completed_at).toBeDefined()

    // 5. Verify no active goal
    const stillHasActive = await goalManagement.hasActiveGoal("session-123")
    expect(stillHasActive).toBe(false)
  })

  it("should handle goal overwrite after completion", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // Create and complete first goal
    await goalManagement.createGoal("session-123", "First", "First done")
    await goalManagement.completeGoal("session-123")

    // Create new goal (should overwrite)
    const newGoal = await goalManagement.createGoal(
      "session-123",
      "Second",
      "Second done"
    )

    expect(newGoal.status).toBe("active")
    expect(newGoal.completed_at).toBeNull()

    const currentGoal = await goalManagement.readGoal("session-123")
    expect(currentGoal?.title).toBe("Second")
  })
})