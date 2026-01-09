/**
 * Tests for helper functions in goal management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createMockPluginContext,
  createMockFileSystem,
  setupMockFileSystem,
} from "./goal-test-setup.js"
import { createGoalManagement } from "../index.js"

describe("GoalManagement - Helper Functions", () => {
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

  describe("hasActiveGoal - Check Active Goal", () => {
    it("should return true when session has active goal", async () => {
      const goalManagement = createGoalManagement(mockContext, {
        goalsBasePath: mockFsContext.basePath,
      })

      await goalManagement.createGoal("session-123", "Active goal", "Done")

      const hasActive = await goalManagement.hasActiveGoal("session-123")

      expect(hasActive).toBe(true)
    })

    it("should return false when no goal exists", async () => {
      const goalManagement = createGoalManagement(mockContext, {
        goalsBasePath: mockFsContext.basePath,
      })

      const hasActive = await goalManagement.hasActiveGoal("non-existent")

      expect(hasActive).toBe(false)
    })

    it("should return false when goal is completed", async () => {
      const goalManagement = createGoalManagement(mockContext, {
        goalsBasePath: mockFsContext.basePath,
      })

      await goalManagement.createGoal("session-123", "Will complete", "Done")
      await goalManagement.completeGoal("session-123")

      const hasActive = await goalManagement.hasActiveGoal("session-123")

      expect(hasActive).toBe(false)
    })
  })

  describe("getGoal - Goal Retrieval Alias", () => {
    it("should work as alias for readGoal", async () => {
      const goalManagement = createGoalManagement(mockContext, {
        goalsBasePath: mockFsContext.basePath,
      })

      await goalManagement.createGoal("session-123", "Alias test", "Done")

      const goal1 = await goalManagement.readGoal("session-123")
      const goal2 = await goalManagement.getGoal("session-123")

      expect(goal1?.title).toBe(goal2?.title)
      expect(goal1?.done_condition).toBe(goal2?.done_condition)
    })
  })
})