/**
 * Simple tests for the task continuation plugin
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { PluginContext, Todo, LoopEvent } from "../types.js"
import { createTaskContinuation } from "../task-continuation.js"

interface PromptCall {
  body: {
    parts: Array<{
      ignored?: boolean
      text: string
    }>
  }
}

// Create a mock context
function createMockContext(): PluginContext {
  const mockSession = {
    id: "test-session",
    get: vi.fn(),
    messages: vi.fn(),
    prompt: vi.fn().mockResolvedValue(undefined),
    todo: vi.fn().mockResolvedValue([]),
  }

  const mockTui = {
    showToast: vi.fn().mockResolvedValue(undefined),
  }

  return {
    directory: "/test/directory",
    client: {
      session: mockSession as PluginContext["client"]["session"],
      tui: mockTui,
    },
  }
}

// Create a mock todo list
function createMockTodos(completed: number, pending: number): Todo[] {
  const todos: Todo[] = []
  for (let i = 0; i < completed; i++) {
    todos.push({
      id: `completed-${i}`,
      content: `Completed task ${i}`,
      status: "completed",
      priority: "high",
    })
  }
  for (let i = 0; i < pending; i++) {
    todos.push({
      id: `pending-${i}`,
      content: `Pending task ${i}`,
      status: "pending",
      priority: "high",
    })
  }
  return todos
}

// Create a session.idle event
function createIdleEvent(sessionID: string): LoopEvent {
  return {
    type: "session.idle",
    properties: { sessionID },
  }
}

// Create a message.updated event
function createUserMessageEvent(sessionID: string): LoopEvent {
  return {
    type: "message.updated",
    properties: {
      sessionID,
      info: { id: "msg-1", sessionID, role: "user" },
    },
  }
}

// Create a session.error event
function createErrorEvent(sessionID: string): LoopEvent {
  return {
    type: "session.error",
    properties: { sessionID, error: new Error("Test error") },
  }
}

// Create a session.deleted event
function createDeletedEvent(sessionID: string): LoopEvent {
  return {
    type: "session.deleted",
    properties: { info: { id: sessionID } },
  }
}

describe("TaskContinuation", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("should create loop with default options", () => {
    const ctx = createMockContext()
    const taskContinuation = createTaskContinuation(ctx)

    expect(taskContinuation).toHaveProperty("handler")
    expect(taskContinuation).toHaveProperty("markRecovering")
    expect(taskContinuation).toHaveProperty("markRecoveryComplete")
    expect(taskContinuation).toHaveProperty("cleanup")
  })

  it("should create loop with custom options", () => {
    const ctx = createMockContext()
    const taskContinuation = createTaskContinuation(ctx, {
      countdownSeconds: 5,
      errorCooldownMs: 10000,
      toastDurationMs: 2000,
      agent: "test-agent",
      model: "test-model",
    })

    expect(taskContinuation).toBeDefined()
  })

  it("should send completion message when all todos are complete", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(3, 0))

    const taskContinuation = createTaskContinuation(ctx)
    await taskContinuation.handler({ event: createIdleEvent("session-123") })

    // Should send a completion status message (ignored: true)
    expect(ctx.client.session.prompt).toHaveBeenCalled()
    interface PromptCall {
      body: {
        parts: Array<{
          ignored?: boolean
          text: string
        }>
      }
    }
    const promptCall = (ctx.client.session.prompt as any).mock.calls[0][0] as PromptCall
    const call: PromptCall = promptCall
    expect(call.body.parts[0].ignored).toBe(true)
    expect(call.body.parts[0].text).toContain("completed")
  })

  it("should inject continuation when incomplete todos remain", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(1, 2))

    const taskContinuation = createTaskContinuation(ctx)
    await taskContinuation.handler({ event: createIdleEvent("session-123") })

    // The prompt should be called after the countdown
    await vi.advanceTimersByTimeAsync(3000)
    expect(ctx.client.session.prompt).toHaveBeenCalled()

    // The continuation prompt should NOT be ignored (it needs to be in context)
    const promptCall = (ctx.client.session.prompt as any).mock.calls[0][0] as PromptCall
    const call: PromptCall = promptCall
    expect(call.body.parts[0].ignored).toBeUndefined()
    expect(call.body.parts[0].text).toContain("AUTO-CONTINUATION")
  })

  it("should handle session without sessionID", async () => {
    const ctx = createMockContext()
    const taskContinuation = createTaskContinuation(ctx)

    await taskContinuation.handler({ event: { type: "session.idle" } })

    expect(ctx.client.session.prompt).not.toHaveBeenCalled()
  })

  it("should prevent continuation when session is recovering", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(0, 1))

    const taskContinuation = createTaskContinuation(ctx)
    taskContinuation.markRecovering("session-123")
    await taskContinuation.handler({ event: createIdleEvent("session-123") })
    await vi.advanceTimersByTimeAsync(3000)

    expect(ctx.client.session.prompt).not.toHaveBeenCalled()
  })

  it("should re-enable continuation after recovery completes", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(0, 1))

    const taskContinuation = createTaskContinuation(ctx)
    taskContinuation.markRecovering("session-123")
    taskContinuation.markRecoveryComplete("session-123")
    await taskContinuation.handler({ event: createIdleEvent("session-123") })
    await vi.advanceTimersByTimeAsync(3000)

    expect(ctx.client.session.prompt).toHaveBeenCalled()
  })

  it("should prevent continuation during error cooldown", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(0, 1))

    const taskContinuation = createTaskContinuation(ctx, { errorCooldownMs: 10000 })
    await taskContinuation.handler({ event: createErrorEvent("session-123") })
    await taskContinuation.handler({ event: createIdleEvent("session-123") })
    await vi.advanceTimersByTimeAsync(3000)

    expect(ctx.client.session.prompt).not.toHaveBeenCalled()
  })

  it("should allow continuation after cooldown expires", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(0, 1))

    const taskContinuation = createTaskContinuation(ctx, { errorCooldownMs: 100 })
    await taskContinuation.handler({ event: createErrorEvent("session-123") })
    await vi.advanceTimersByTimeAsync(200)
    await taskContinuation.handler({ event: createIdleEvent("session-123") })
    await vi.advanceTimersByTimeAsync(3000)

    expect(ctx.client.session.prompt).toHaveBeenCalled()
  })

  it("should clear error state on user message", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(0, 1))

    const taskContinuation = createTaskContinuation(ctx, { errorCooldownMs: 10000 })
    await taskContinuation.handler({ event: createErrorEvent("session-123") })
    await taskContinuation.handler({ event: createUserMessageEvent("session-123") })
    await taskContinuation.handler({ event: createIdleEvent("session-123") })
    await vi.advanceTimersByTimeAsync(3000)

    expect(ctx.client.session.prompt).toHaveBeenCalled()
  })

  it("should cleanup session state on session.deleted", async () => {
    const ctx = createMockContext()
    const taskContinuation = createTaskContinuation(ctx)

    await taskContinuation.handler({ event: createDeletedEvent("session-123") })

    expect(ctx.client.session.prompt).not.toHaveBeenCalled()
  })
})
