/**
 * Tests for TaskLoop functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createTaskLoop } from "../task-loop"
import type { PluginContext, Todo, LoopEvent } from "../types"

// Mock timers for countdown testing
vi.useFakeTimers()

describe("TaskLoop", () => {
  let mockContext: PluginContext
  let mockTodoFn: ReturnType<typeof vi.fn>
  let mockPromptFn: ReturnType<typeof vi.fn>
  let mockShowToastFn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetAllMocks()

    // Setup default mock functions
    mockTodoFn = vi.fn().mockResolvedValue({ data: [] })
    mockPromptFn = vi.fn().mockResolvedValue(undefined)
    mockShowToastFn = vi.fn().mockResolvedValue(undefined)

    // Create mock context
    mockContext = {
      directory: "/test/directory",
      client: {
        session: {
          prompt: mockPromptFn,
          todo: mockTodoFn,
        },
        tui: {
          showToast: mockShowToastFn,
        },
      },
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe("creation", () => {
    it("should create loop with default options", () => {
      const taskLoop = createTaskLoop(mockContext)

      expect(taskLoop).toHaveProperty("handler")
      expect(taskLoop).toHaveProperty("markRecovering")
      expect(taskLoop).toHaveProperty("markRecoveryComplete")
      expect(taskLoop).toHaveProperty("cleanup")
    })

    it("should create loop with custom options", () => {
      const taskLoop = createTaskLoop(mockContext, {
        countdownSeconds: 5,
        errorCooldownMs: 10000,
        toastDurationMs: 2000,
      })

      expect(taskLoop).toBeDefined()
    })
  })

  describe("handler - session.idle", () => {
    it("should inject continuation when incomplete todos remain", async () => {
      const todos: Todo[] = [
        { id: "1", content: "Task 1", status: "pending", priority: "high" },
        { id: "2", content: "Task 2", status: "in_progress", priority: "medium" },
      ]
      mockTodoFn.mockResolvedValue({ data: todos })

      const taskLoop = createTaskLoop(mockContext, { countdownSeconds: 0 })

      const event: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }

      await taskLoop.handler({ event })

      // Advance timers to trigger the countdown timeout
      vi.advanceTimersByTime(0)

      expect(mockPromptFn).toHaveBeenCalled()
    })

    it("should not inject continuation when all todos are complete", async () => {
      const todos: Todo[] = [
        { id: "1", content: "Task 1", status: "completed", priority: "high" },
        { id: "2", content: "Task 2", status: "completed", priority: "medium" },
      ]
      mockTodoFn.mockResolvedValue({ data: todos })

      const taskLoop = createTaskLoop(mockContext)

      const event: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }

      await taskLoop.handler({ event })

      expect(mockPromptFn).not.toHaveBeenCalled()
    })

    it("should not inject continuation when no todos exist", async () => {
      mockTodoFn.mockResolvedValue({ data: [] })

      const taskLoop = createTaskLoop(mockContext)

      const event: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }

      await taskLoop.handler({ event })

      expect(mockPromptFn).not.toHaveBeenCalled()
    })

    it("should handle session without sessionID", async () => {
      const taskLoop = createTaskLoop(mockContext)

      const event: LoopEvent = {
        type: "session.idle",
        properties: {},
      }

      await taskLoop.handler({ event })

      expect(mockTodoFn).not.toHaveBeenCalled()
    })
  })

  describe("countdown", () => {
    it("should start countdown on session.idle with incomplete todos", async () => {
      const todos: Todo[] = [{ id: "1", content: "Task 1", status: "pending", priority: "high" }]
      mockTodoFn.mockResolvedValue({ data: todos })

      const taskLoop = createTaskLoop(mockContext, { countdownSeconds: 2 })

      const event: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }

      await taskLoop.handler({ event })

      expect(mockShowToastFn).toHaveBeenCalled()
    })

    it("should cancel countdown on user message", async () => {
      const todos: Todo[] = [{ id: "1", content: "Task 1", status: "pending", priority: "high" }]
      mockTodoFn.mockResolvedValue({ data: todos })

      const taskLoop = createTaskLoop(mockContext, { countdownSeconds: 5 })

      // First, trigger session.idle to start countdown
      const idleEvent: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }
      await taskLoop.handler({ event: idleEvent })

      // Then send user message
      const userMessageEvent: LoopEvent = {
        type: "message.updated",
        properties: {
          info: { sessionID: "session-123", role: "user" },
        },
      }
      await taskLoop.handler({ event: userMessageEvent })

      // Advance timers past countdown
      vi.advanceTimersByTime(6000)

      // Prompt should not be called due to countdown cancellation
      expect(mockPromptFn).not.toHaveBeenCalled()
    })

    it("should cancel countdown on assistant message", async () => {
      const todos: Todo[] = [{ id: "1", content: "Task 1", status: "pending", priority: "high" }]
      mockTodoFn.mockResolvedValue({ data: todos })

      const taskLoop = createTaskLoop(mockContext, { countdownSeconds: 5 })

      // First, trigger session.idle to start countdown
      const idleEvent: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }
      await taskLoop.handler({ event: idleEvent })

      // Then send assistant message
      const assistantMessageEvent: LoopEvent = {
        type: "message.updated",
        properties: {
          info: { sessionID: "session-123", role: "assistant" },
        },
      }
      await taskLoop.handler({ event: assistantMessageEvent })

      // Advance timers past countdown
      vi.advanceTimersByTime(6000)

      // Prompt should not be called due to countdown cancellation
      expect(mockPromptFn).not.toHaveBeenCalled()
    })
  })

  describe("recovery mode", () => {
    it("should prevent continuation when session is recovering", async () => {
      const taskLoop = createTaskLoop(mockContext)

      // Mark session as recovering
      taskLoop.markRecovering("session-123")

      const todos: Todo[] = [{ id: "1", content: "Task 1", status: "pending", priority: "high" }]
      mockTodoFn.mockResolvedValue({ data: todos })

      const event: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }

      await taskLoop.handler({ event })

      expect(mockPromptFn).not.toHaveBeenCalled()
    })

    it("should re-enable continuation after recovery completes", async () => {
      const taskLoop = createTaskLoop(mockContext)

      // Mark session as recovering and then complete
      taskLoop.markRecovering("session-123")
      taskLoop.markRecoveryComplete("session-123")

      const todos: Todo[] = [{ id: "1", content: "Task 1", status: "pending", priority: "high" }]
      mockTodoFn.mockResolvedValue({ data: todos })

      const event: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }

      await taskLoop.handler({ event })

      expect(mockPromptFn).toHaveBeenCalled()
    })
  })

  describe("error cooldown", () => {
    it("should prevent continuation during error cooldown", async () => {
      const taskLoop = createTaskLoop(mockContext, { errorCooldownMs: 5000 })

      // Simulate an error
      const errorEvent: LoopEvent = {
        type: "session.error",
        properties: { sessionID: "session-123", error: new Error("Test error") },
      }
      await taskLoop.handler({ event: errorEvent })

      const todos: Todo[] = [{ id: "1", content: "Task 1", status: "pending", priority: "high" }]
      mockTodoFn.mockResolvedValue({ data: todos })

      // Try to inject continuation during cooldown
      const idleEvent: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }
      await taskLoop.handler({ event: idleEvent })

      expect(mockPromptFn).not.toHaveBeenCalled()
    })

    it("should allow continuation after cooldown expires", async () => {
      const taskLoop = createTaskLoop(mockContext, { errorCooldownMs: 100 })

      // Simulate an error
      const errorEvent: LoopEvent = {
        type: "session.error",
        properties: { sessionID: "session-123", error: new Error("Test error") },
      }
      await taskLoop.handler({ event: errorEvent })

      // Advance timers past cooldown
      vi.advanceTimersByTime(200)

      const todos: Todo[] = [{ id: "1", content: "Task 1", status: "pending", priority: "high" }]
      mockTodoFn.mockResolvedValue({ data: todos })

      // Try to inject continuation after cooldown
      const idleEvent: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }
      await taskLoop.handler({ event: idleEvent })

      expect(mockPromptFn).toHaveBeenCalled()
    })

    it("should clear error state on user message", async () => {
      const taskLoop = createTaskLoop(mockContext, { errorCooldownMs: 5000 })

      // Simulate an error
      const errorEvent: LoopEvent = {
        type: "session.error",
        properties: { sessionID: "session-123", error: new Error("Test error") },
      }
      await taskLoop.handler({ event: errorEvent })

      // User sends message
      const userMessageEvent: LoopEvent = {
        type: "message.updated",
        properties: {
          info: { sessionID: "session-123", role: "user" },
        },
      }
      await taskLoop.handler({ event: userMessageEvent })

      const todos: Todo[] = [{ id: "1", content: "Task 1", status: "pending", priority: "high" }]
      mockTodoFn.mockResolvedValue({ data: todos })

      // Should now allow continuation
      const idleEvent: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }
      await taskLoop.handler({ event: idleEvent })

      expect(mockPromptFn).toHaveBeenCalled()
    })
  })

  describe("cleanup", () => {
    it("should cleanup session state on session.deleted", async () => {
      const taskLoop = createTaskLoop(mockContext, { countdownSeconds: 5 })

      // Mark session as recovering first
      taskLoop.markRecovering("session-123")

      const deleteEvent: LoopEvent = {
        type: "session.deleted",
        properties: { info: { id: "session-123" } },
      }

      await taskLoop.handler({ event: deleteEvent })

      // Session should be cleaned up
      const todos: Todo[] = [{ id: "1", content: "Task 1", status: "pending", priority: "high" }]
      mockTodoFn.mockResolvedValue({ data: todos })

      // Session should not be in recovering state anymore
      const event: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }
      await taskLoop.handler({ event: event })

      expect(mockPromptFn).toHaveBeenCalled()
    })

    it("should cancel countdown on session deletion", async () => {
      const taskLoop = createTaskLoop(mockContext, { countdownSeconds: 5 })

      const todos: Todo[] = [{ id: "1", content: "Task 1", status: "pending", priority: "high" }]
      mockTodoFn.mockResolvedValue({ data: todos })

      // Start countdown
      const idleEvent: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }
      await taskLoop.handler({ event: idleEvent })

      // Delete session
      const deleteEvent: LoopEvent = {
        type: "session.deleted",
        properties: { info: { id: "session-123" } },
      }
      await taskLoop.handler({ event: deleteEvent })

      // Advance timers past countdown
      vi.advanceTimersByTime(6000)

      // Prompt should not be called due to cleanup
      expect(mockPromptFn).not.toHaveBeenCalled()
    })
  })

  describe("tool execution events", () => {
    it("should cancel countdown on tool.execute.before", async () => {
      const taskLoop = createTaskLoop(mockContext, { countdownSeconds: 5 })

      const todos: Todo[] = [{ id: "1", content: "Task 1", status: "pending", priority: "high" }]
      mockTodoFn.mockResolvedValue({ data: todos })

      // Start countdown
      const idleEvent: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }
      await taskLoop.handler({ event: idleEvent })

      // Tool execution starts
      const toolEvent: LoopEvent = {
        type: "tool.execute.before",
        properties: { sessionID: "session-123" },
      }
      await taskLoop.handler({ event: toolEvent })

      // Advance timers past countdown
      vi.advanceTimersByTime(6000)

      // Prompt should not be called due to countdown cancellation
      expect(mockPromptFn).not.toHaveBeenCalled()
    })

    it("should cancel countdown on tool.execute.after", async () => {
      const taskLoop = createTaskLoop(mockContext, { countdownSeconds: 5 })

      const todos: Todo[] = [{ id: "1", content: "Task 1", status: "pending", priority: "high" }]
      mockTodoFn.mockResolvedValue({ data: todos })

      // Start countdown
      const idleEvent: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }
      await taskLoop.handler({ event: idleEvent })

      // Tool execution completes
      const toolEvent: LoopEvent = {
        type: "tool.execute.after",
        properties: { sessionID: "session-123" },
      }
      await taskLoop.handler({ event: toolEvent })

      // Advance timers past countdown
      vi.advanceTimersByTime(6000)

      // Prompt should not be called due to countdown cancellation
      expect(mockPromptFn).not.toHaveBeenCalled()
    })
  })

  describe("message.part.updated events", () => {
    it("should cancel countdown on assistant message part update", async () => {
      const taskLoop = createTaskLoop(mockContext, { countdownSeconds: 5 })

      const todos: Todo[] = [{ id: "1", content: "Task 1", status: "pending", priority: "high" }]
      mockTodoFn.mockResolvedValue({ data: todos })

      // Start countdown
      const idleEvent: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }
      await taskLoop.handler({ event: idleEvent })

      // Message part update
      const partUpdateEvent: LoopEvent = {
        type: "message.part.updated",
        properties: {
          info: { sessionID: "session-123", role: "assistant" },
        },
      }
      await taskLoop.handler({ event: partUpdateEvent })

      // Advance timers past countdown
      vi.advanceTimersByTime(6000)

      // Prompt should not be called due to countdown cancellation
      expect(mockPromptFn).not.toHaveBeenCalled()
    })
  })
})
