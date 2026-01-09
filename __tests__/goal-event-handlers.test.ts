/**
 * Tests for event handlers in goal management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createMockPluginContext,
  createMockFileSystem,
  setupMockFileSystem,
} from "./goal-test-setup.js"
import { createGoalManagement } from "../index.js"
import type { LoopEvent } from "../types.js"

describe("GoalManagement - Event Handler Tests", () => {
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

  it("should handle goal_set command event", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const goalSetEvent: LoopEvent = {
      type: "command",
      properties: {
        sessionID: "session-123",
        info: {
          command: "goal_set",
          args: {
            title: "Event-based goal",
            done_condition: "Event goal is done",
            description: "Created via event",
          },
        },
      },
    }

    // Call the handler with the event
    await goalManagement.handler({ event: goalSetEvent })

    // Verify goal was created
    const goal = await goalManagement.readGoal("session-123")
    expect(goal?.title).toBe("Event-based goal")
    expect(goal?.done_condition).toBe("Event goal is done")
    expect(goal?.description).toBe("Created via event")
    expect(goal?.status).toBe("active")
  })

  it("should handle goal_done command event", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    // First create a goal
    await goalManagement.createGoal("session-123", "Goal to complete", "Done")

    // Then send goal_done event
    const goalDoneEvent: LoopEvent = {
      type: "command",
      properties: {
        sessionID: "session-123",
        info: {
          command: "goal_done",
        },
      },
    }

    await goalManagement.handler({ event: goalDoneEvent })

    // Verify goal is completed
    const goal = await goalManagement.readGoal("session-123")
    expect(goal?.status).toBe("completed")
    expect(goal?.completed_at).not.toBeNull()
  })

  it("should handle handler with sessionID in properties", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const event: LoopEvent = {
      type: "command",
      properties: {
        sessionID: "session-456",
        info: {
          command: "goal_set",
          args: {
            title: "Handler test goal",
            done_condition: "Handler test done",
          },
        },
      },
    }

    await goalManagement.handler({ event: event })

    const goal = await goalManagement.readGoal("session-456")
    expect(goal?.title).toBe("Handler test goal")
  })

  it("should handle handler with sessionID in info", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const event: LoopEvent = {
      type: "command",
      properties: {
        info: {
          sessionID: "session-789",
          command: "goal_set",
          args: {
            title: "Info session goal",
            done_condition: "Info session done",
          },
        },
      },
    }

    await goalManagement.handler({ event: event })

    const goal = await goalManagement.readGoal("session-789")
    expect(goal?.title).toBe("Info session goal")
  })

  it("should handle goal_set with missing title", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const event: LoopEvent = {
      type: "command",
      properties: {
        sessionID: "session-123",
        info: {
          command: "goal_set",
          args: {
            done_condition: "Done condition only",
          },
        },
      },
    }

    // Should not throw, but should not create goal
    await goalManagement.handler({ event: event })

    const goal = await goalManagement.readGoal("session-123")
    expect(goal).toBeNull()
  })

  it("should handle goal_set with missing done_condition", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const event: LoopEvent = {
      type: "command",
      properties: {
        sessionID: "session-123",
        info: {
          command: "goal_set",
          args: {
            title: "Title only goal",
          },
        },
      },
    }

    await goalManagement.handler({ event: event })

    const goal = await goalManagement.readGoal("session-123")
    expect(goal).toBeNull()
  })

  it("should handle goal_done when no goal exists", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const event: LoopEvent = {
      type: "command",
      properties: {
        sessionID: "non-existent-session",
        info: {
          command: "goal_done",
        },
      },
    }

    // Should not throw
    await goalManagement.handler({ event: event })

    // No goal should exist
    const goal = await goalManagement.readGoal("non-existent-session")
    expect(goal).toBeNull()
  })

  it("should handle non-goal command events gracefully", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const event: LoopEvent = {
      type: "command",
      properties: {
        sessionID: "session-123",
        info: {
          command: "other_command",
          args: {},
        },
      },
    }

    // Should not throw
    await goalManagement.handler({ event: event })

    // No goal should be created
    const goal = await goalManagement.readGoal("session-123")
    expect(goal).toBeNull()
  })

  it("should handle events without command property", async () => {
    const goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: mockFsContext.basePath,
    })

    const event: LoopEvent = {
      type: "message",
      properties: {
        sessionID: "session-123",
        info: {
          role: "user",
        },
      },
    }

    // Should not throw
    await goalManagement.handler({ event: event })

    // No goal should be created
    const goal = await goalManagement.readGoal("session-123")
    expect(goal).toBeNull()
  })
})