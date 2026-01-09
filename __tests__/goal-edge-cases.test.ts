/**
 * Tests for edge cases in goal management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createMockPluginContext,
  createMockFileSystem,
  setupMockFileSystem,
} from "./goal-test-setup.js"
import { createGoalManagement } from "../index.js"

describe("GoalManagement - Edge Cases", () => {
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

  it("should handle goal with special characters in title", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const goal = await goalManagement.createGoal(
      "session-123",
      "Goal with \"quotes\" and 'apostrophes'",
      "Done"
    )

    expect(goal.title).toContain("quotes")
    expect(goal.title).toContain("apostrophes")
  })

  it("should handle goal with empty description", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const goal = await goalManagement.createGoal(
      "session-123",
      "No description",
      "Done"
    )

    expect(goal.description).toBeUndefined()
  })

  it("should handle very long goal title", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const longTitle = "A".repeat(1000)
    const goal = await goalManagement.createGoal(
      "session-123",
      longTitle,
      "Done"
    )

    expect(goal.title.length).toBe(1000)
  })
})