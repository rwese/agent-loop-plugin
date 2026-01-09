/**
 * Integration test for goal-aware continuation logic
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { PluginContext, Goal, GoalManagement } from "../types.js"
import { createTaskContinuation, createGoalManagement } from "../index.js"

// Mock the fs module
vi.mock("node:fs/promises")

// Mock path module for path operations
vi.mock("node:path", () => ({
  dirname: vi.fn((p: string) => p.replace(/\/[^/]+$/, "")),
}))

describe("Goal-Aware Continuation Integration", () => {
  let mockContext: PluginContext
  let goalManagement: GoalManagement

  beforeEach(() => {
    // Create a mock context for testing
    mockContext = {
      directory: "/test",
      client: {
        session: {
          id: "test-session",
          get: vi.fn().mockResolvedValue({ 
            agent: "test-agent", 
            model: { providerID: "test", modelID: "test-model" } 
          }),
          messages: vi.fn().mockResolvedValue([
            { 
              info: { 
                agent: "test-agent", 
                model: { providerID: "test", modelID: "test-model" },
                role: "user" 
              }, 
              parts: [] 
            }
          ]),
          prompt: vi.fn().mockResolvedValue(undefined),
          todo: vi.fn().mockResolvedValue([]),
        },
        tui: {
          showToast: vi.fn().mockResolvedValue(undefined),
        },
      },
    } as unknown as PluginContext

    // Setup mock file system operations
    const sessionGoals = new Map<string, Goal>()
    
    vi.mocked(fs.readFile).mockReset()
    vi.mocked(fs.writeFile).mockReset()
    vi.mocked(fs.mkdir).mockReset()

    vi.mocked(fs.readFile).mockImplementation(async (filePath, encoding) => {
      const sessionMatch = (filePath as string).match(/\/([^/]+)\/goal\.json$/)
      if (sessionMatch) {
        const sessionId = sessionMatch[1]
        const goal = sessionGoals.get(sessionId)
        if (goal) {
          return JSON.stringify(goal)
        }
      }
      const error = new Error("File not found") as Error & { code: string }
      error.code = "ENOENT"
      throw error
    })

    vi.mocked(fs.writeFile).mockImplementation(async (filePath, data, encoding) => {
      const sessionMatch = (filePath as string).match(/\/([^/]+)\/goal\.json$/)
      if (sessionMatch) {
        const sessionId = sessionMatch[1]
        const goal = JSON.parse(data as string)
        sessionGoals.set(sessionId, goal)
      }
    })

    vi.mocked(fs.mkdir).mockResolvedValue(undefined)

    // Create goal management instance
    goalManagement = createGoalManagement(mockContext, {
      goalsBasePath: "/test/goals",
    })
  })

  it("should continue when active goal exists even with no incomplete todos", async () => {
    // Set up no incomplete todos
    vi.mocked(mockContext.client.session.todo).mockResolvedValue([])

    // Create an active goal
    await goalManagement.createGoal("test-session", "Test Goal", "Goal is completed")

    // Create task continuation with goal management
    const taskContinuation = createTaskContinuation(mockContext, {
      goalManagement,
      countdownSeconds: 0.1, // Short countdown for testing
    })

    // Simulate session.idle event (should trigger continuation due to active goal)
    await taskContinuation.handler({
      event: {
        type: "session.idle",
        properties: { sessionID: "test-session" },
      },
    })

    // Wait a bit for the countdown to fire
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Verify that prompt was called (continuation was injected)
    expect(mockContext.client.session.prompt).toHaveBeenCalled()

    // Clean up
    await taskContinuation.cleanup()
  })

  it("should not continue when goal is completed and no incomplete todos exist", async () => {
    // Set up no incomplete todos
    vi.mocked(mockContext.client.session.todo).mockResolvedValue([])

    // Create and complete a goal
    await goalManagement.createGoal("test-session", "Test Goal", "Goal is completed")
    await goalManagement.completeGoal("test-session")

    // Create task continuation with goal management
    const taskContinuation = createTaskContinuation(mockContext, {
      goalManagement,
      countdownSeconds: 0.1,
    })

    // Simulate session.idle event
    await taskContinuation.handler({
      event: {
        type: "session.idle",
        properties: { sessionID: "test-session" },
      },
    })

    // Wait for potential countdown
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Verify that prompt was NOT called (no continuation should happen)
    expect(mockContext.client.session.prompt).not.toHaveBeenCalled()

    // Clean up
    await taskContinuation.cleanup()
  })
})
