/**
 * Tests for goal management functionality
 *
 * Tests the following features:
 * - Goal creation (createGoal/goal_set)
 * - Goal completion (completeGoal/goal_done)
 * - Goal retrieval (readGoal/goal_get)
 * - Goal overwrite behavior
 * - Error cases (no goal when completing)
 * - File I/O operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"

// Mock the fs module
vi.mock("node:fs/promises")

// Import the actual types and functions from the codebase
import type { Goal, GoalManagement, GoalManagementOptions, LoopEvent, PluginContext } from "../types.js"
import { createGoalManagement } from "../index.js"

// ============================================================================
// Test Setup and Utilities
// ============================================================================

// Mock path module for path operations
vi.mock("node:path", () => ({
  dirname: vi.fn((p: string) => p.replace(/\/[^/]+$/, "")),
}))

// Create a mock PluginContext for testing
function createMockPluginContext(): PluginContext {
  return {
    directory: "/test",
    client: {
      session: {
        id: "test-session",
        get: vi.fn(),
        messages: vi.fn(),
        prompt: vi.fn().mockResolvedValue(undefined),
        todo: vi.fn().mockResolvedValue([]),
      },
      tui: {
        showToast: vi.fn().mockResolvedValue(undefined),
      },
    },
    on: vi.fn(),
  }
}

interface MockFileSystemContext {
  basePath: string
  goalsFile: string
  storedGoal: Goal | null
  writeCalls: Array<[string, string]>
}

// Initialize mock file system storage
function createMockFileSystem(): MockFileSystemContext {
  return {
    basePath: "/test/directory/.goals",
    goalsFile: "/test/directory/.goals/session-123/goal.json",
    storedGoal: null,
    writeCalls: [],
  }
}

// Setup mock file system operations
function setupMockFileSystem(ctx: MockFileSystemContext) {
  vi.mocked(fs.readFile).mockReset()
  vi.mocked(fs.writeFile).mockReset()
  vi.mocked(fs.mkdir).mockReset()

  // Storage for goals from any session
  const sessionGoals = new Map<string, Goal>()

  vi.mocked(fs.readFile).mockImplementation(async (filePath, encoding) => {
    // Extract session ID from path and check if goal exists
    const sessionMatch =  (filePath as string).match(/\/([^/]+)\/goal\.json$/)
    if (sessionMatch) {
      const sessionId = sessionMatch[1]
      const goal = sessionGoals.get(sessionId)
      if (goal) {
        return JSON.stringify(goal)
      }
      // Fallback to old storedGoal interface for backward compatibility
      if (sessionId === "session-123" && ctx.storedGoal !== null) {
        return JSON.stringify(ctx.storedGoal)
      }
    }
    const error = new Error("File not found") as Error & { code: string }
    error.code = "ENOENT"
    throw error
  })

  vi.mocked(fs.writeFile).mockImplementation(async (filePath, data, encoding) => {
    ctx.writeCalls.push([filePath as string, data as string])
    // Extract session ID and store the goal
    const sessionMatch =  (filePath as string).match(/\/([^/]+)\/goal\.json$/)
    if (sessionMatch) {
      const sessionId = sessionMatch[1]
      const goal = JSON.parse(data as string)
      sessionGoals.set(sessionId, goal)
    }
  })

  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
}

// ============================================================================
// Goal Management Tests
// ============================================================================

describe("GoalManagement", () => {
  let mockFsContext: MockFileSystemContext
  let mockContext: PluginContext

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

  // ===========================================================================
  // Goal Creation Tests (createGoal/goal_set)
  // ===========================================================================

  describe("createGoal - Goal Creation", () => {
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

  // ===========================================================================
  // Goal Completion Tests (completeGoal/goal_done)
  // ===========================================================================

  describe("completeGoal - Goal Completion", () => {
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

  // ===========================================================================
  // Goal Retrieval Tests (readGoal/goal_get)
  // ===========================================================================

  describe("readGoal - Goal Retrieval", () => {
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

  // ===========================================================================
  // Goal Overwrite Tests
  // ===========================================================================

  describe("Goal Overwrite Behavior", () => {
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

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe("Error Handling", () => {
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
      vi.mocked(fs.readFile).mockRejectedValue(new Error("Permission denied"))

      const goal = await goalManagement.readGoal("session-123")

      expect(goal).toBeNull()
    })

    it("should handle write errors gracefully", async () => {
      const goalManagement = createGoalManagement(mockContext, {
        goalsBasePath: mockFsContext.basePath,
      })

      // Mock writeFile to throw an error
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
      vi.mocked(fs.mkdir).mockRejectedValue(new Error("Directory creation failed"))

      await expect(
        goalManagement.createGoal("session-123", "Test goal", "Done")
      ).rejects.toThrow()
    })
  })

  // ===========================================================================
  // File I/O Tests
  // ===========================================================================

  describe("File I/O Operations", () => {
    it("should use correct file path for goal storage", async () => {
      const goalManagement = createGoalManagement(mockContext, {
        goalsBasePath: mockFsContext.basePath,
      })

      await goalManagement.createGoal("session-123", "Path test", "Done")

      // Verify the correct path was used
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

    it("should handle concurrent file operations", async () => {
      const goalManagement = createGoalManagement(mockContext, {
        goalsBasePath: mockFsContext.basePath,
      })

      // Reset write calls for this test
      mockFsContext.writeCalls = []

      // Create multiple goals concurrently
      const concurrentOperations = Array.from({ length: 5 }, (_, i) =>
        goalManagement.createGoal(
          `session-${i}`,
          `Concurrent goal ${i}`,
          "Done"
        )
      )

      await Promise.all(concurrentOperations)

      // All operations should complete - verify write calls were made
      const writeCalls = mockFsContext.writeCalls.filter(call => 
        call[0].includes("session-")
      )
      expect(writeCalls.length).toBeGreaterThanOrEqual(5)
    })
  })

  // ===========================================================================
  // Helper Function Tests
  // ===========================================================================

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

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe("Edge Cases", () => {
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

    it("should handle concurrent reads and writes", async () => {
      const goalManagement = createGoalManagement(mockContext, {
        goalsBasePath: mockFsContext.basePath,
      })

      // Create a goal first
      await goalManagement.createGoal("session-123", "Initial", "Done")

      // Perform concurrent read and write
      const readPromise = goalManagement.readGoal("session-123")
      const writePromise = goalManagement.createGoal(
        "session-123",
        "Concurrent update",
        "Done"
      )

      await Promise.all([readPromise, writePromise])

      // Both operations should complete without error
      expect(fs.readFile).toHaveBeenCalled()
      expect(fs.writeFile).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Integration Tests
  // ===========================================================================

  describe("Integration Tests", () => {
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

  // ===========================================================================
  // Event Handler Tests (handleGoalEvent and handler)
  // ===========================================================================

  describe("Event Handler Tests", () => {
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
})
