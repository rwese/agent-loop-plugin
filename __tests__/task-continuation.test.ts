/**
 * Simple tests for the task continuation plugin
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { PluginContext, Todo, LoopEvent } from "../types.js"
import { createTaskContinuation } from "../task-continuation.js"

interface PromptCall {
  body: {
    agent?: string
    model?: string
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

// Create a message.updated event with agent/model
function createUserMessageEventWithAgentModel(
  sessionID: string,
  agent: string,
  model: string
): LoopEvent {
  return {
    type: "message.updated",
    properties: {
      sessionID,
      info: { id: "msg-1", sessionID, role: "user", agent, model },
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

  it("should use tracked agent/model from user message for continuation", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(0, 1))

    const taskContinuation = createTaskContinuation(ctx, {
      agent: "configured-agent",
      model: "configured-model",
    })

    // Simulate a user message with a specific agent/model
    const userMessageEvent = createUserMessageEventWithAgentModel(
      "session-123",
      "user-agent",
      "user-model"
    )
    await taskContinuation.handler({ event: userMessageEvent })

    // Now trigger a session idle event
    await taskContinuation.handler({ event: createIdleEvent("session-123") })

    // The prompt should be called after the countdown
    await vi.advanceTimersByTimeAsync(3000)
    expect(ctx.client.session.prompt).toHaveBeenCalled()

    // Verify that the continuation used the user message agent/model, not the configured ones
    const promptCall = (ctx.client.session.prompt as any).mock.calls[0][0] as PromptCall
    expect(promptCall.body.agent).toBe("user-agent")
    expect(promptCall.body.model).toBe("user-model")
  })

  it("should fall back to configured agent/model when no user message agent/model is available", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(0, 1))

    const taskContinuation = createTaskContinuation(ctx, {
      agent: "configured-agent",
      model: "configured-model",
    })

    // Trigger a session idle event without a prior user message
    await taskContinuation.handler({ event: createIdleEvent("session-123") })

    // The prompt should be called after the countdown
    await vi.advanceTimersByTimeAsync(3000)
    expect(ctx.client.session.prompt).toHaveBeenCalled()

    // Verify that the continuation used the configured agent/model
    const promptCall = (ctx.client.session.prompt as any).mock.calls[0][0] as PromptCall
    expect(promptCall.body.agent).toBe("configured-agent")
    expect(promptCall.body.model).toBe("configured-model")
  })

  it("should use tracked agent/model for completion message", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    // All tasks completed
    mockTodoFn.mockResolvedValue(createMockTodos(3, 0))

    const taskContinuation = createTaskContinuation(ctx, {
      agent: "configured-agent",
      model: "configured-model",
    })

    // Simulate a user message with a specific agent/model
    const userMessageEvent = createUserMessageEventWithAgentModel(
      "session-123",
      "user-agent",
      "user-model"
    )
    await taskContinuation.handler({ event: userMessageEvent })

    // Trigger a session idle event (all tasks are completed)
    await taskContinuation.handler({ event: createIdleEvent("session-123") })

    // Verify that the completion message used the user message agent/model
    expect(ctx.client.session.prompt).toHaveBeenCalled()
    const promptCall = (ctx.client.session.prompt as any).mock.calls[0][0] as PromptCall
    expect(promptCall.body.agent).toBe("user-agent")
    expect(promptCall.body.model).toBe("user-model")
    expect(promptCall.body.parts[0].ignored).toBe(true)
  })

  // ===========================================================================
  // Regression Tests: Message Filtering for Countdown Cancellation
  // These tests prevent the bug where message updates incorrectly cancelled countdowns
  // Bug: OpenCode sends multiple message.updated events for the same message
  // (initial creation, summary updates, metadata changes). The plugin was treating
  // ALL of these as new user input and cancelling the countdown.
  // Fix: Filter messages by role, summary presence, and message ID tracking.
  // ===========================================================================

  it("should NOT cancel countdown when message has summary (message update)", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(0, 1))

    const taskContinuation = createTaskContinuation(ctx, { countdownSeconds: 2 })

    // Trigger idle - countdown should be scheduled
    await taskContinuation.handler({ event: createIdleEvent("session-123") })
    expect(ctx.client.tui.showToast).toHaveBeenCalled()

    // Advance time but not enough to fire countdown
    await vi.advanceTimersByTimeAsync(500)

    // Simulate a message update with summary (this should NOT cancel countdown)
    const messageUpdateEvent: LoopEvent = {
      type: "message.updated",
      properties: {
        sessionID: "session-123",
        info: {
          id: "msg-1",
          sessionID: "session-123",
          role: "user",
          summary: { title: "Test task" },
        } as any,
      },
    }
    await taskContinuation.handler({ event: messageUpdateEvent })

    // Advance time past the countdown
    await vi.advanceTimersByTimeAsync(3000)

    // Countdown should have fired and prompt should be injected
    expect(ctx.client.session.prompt).toHaveBeenCalled()
  })

  it("should cancel countdown when genuine new user message arrives", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(0, 1))

    const taskContinuation = createTaskContinuation(ctx, { countdownSeconds: 2 })

    // Trigger idle - countdown should be scheduled
    await taskContinuation.handler({ event: createIdleEvent("session-123") })
    expect(ctx.client.tui.showToast).toHaveBeenCalled()

    // Advance time but not enough to fire countdown
    await vi.advanceTimersByTimeAsync(500)

    // Simulate a genuine new user message (no summary)
    const newUserMessageEvent: LoopEvent = {
      type: "message.updated",
      properties: {
        sessionID: "session-123",
        info: {
          id: "msg-2",
          sessionID: "session-123",
          role: "user",
          time: { created: Date.now() },
        } as any,
      },
    }
    await taskContinuation.handler({ event: newUserMessageEvent })

    // Advance time past the original countdown
    await vi.advanceTimersByTimeAsync(3000)

    // Prompt should NOT be called because countdown was cancelled
    expect(ctx.client.session.prompt).not.toHaveBeenCalled()
  })

  it("should NOT cancel countdown for repeated message events (same ID)", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(0, 1))

    const taskContinuation = createTaskContinuation(ctx, { countdownSeconds: 2 })

    // First, send a user message to establish the message ID tracking
    const initialMessageEvent: LoopEvent = {
      type: "message.updated",
      properties: {
        sessionID: "session-123",
        info: { id: "msg-1", sessionID: "session-123", role: "user" } as any,
      },
    }
    await taskContinuation.handler({ event: initialMessageEvent })

    // Now trigger idle - countdown should be scheduled
    await taskContinuation.handler({ event: createIdleEvent("session-123") })
    expect(ctx.client.tui.showToast).toHaveBeenCalled()

    // Advance time but not enough to fire countdown
    await vi.advanceTimersByTimeAsync(500)

    // Now send the SAME message event again (same ID) - should NOT cancel
    const repeatedMessageEvent: LoopEvent = {
      type: "message.updated",
      properties: {
        sessionID: "session-123",
        info: { id: "msg-1", sessionID: "session-123", role: "user" } as any,
      },
    }
    await taskContinuation.handler({ event: repeatedMessageEvent })
    await taskContinuation.handler({ event: repeatedMessageEvent })
    await taskContinuation.handler({ event: repeatedMessageEvent })

    // Advance time past the countdown
    await vi.advanceTimersByTimeAsync(3000)

    // Countdown should have fired (repeated message ID shouldn't cancel)
    expect(ctx.client.session.prompt).toHaveBeenCalled()
  })

  it("should NOT cancel countdown for assistant messages", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(0, 1))

    const taskContinuation = createTaskContinuation(ctx, { countdownSeconds: 2 })

    // Trigger idle - countdown should be scheduled
    await taskContinuation.handler({ event: createIdleEvent("session-123") })
    expect(ctx.client.tui.showToast).toHaveBeenCalled()

    // Advance time but not enough to fire countdown
    await vi.advanceTimersByTimeAsync(500)

    // Simulate an assistant message (should NOT cancel countdown)
    const assistantMessageEvent: LoopEvent = {
      type: "message.updated",
      properties: {
        sessionID: "session-123",
        info: { id: "msg-1", sessionID: "session-123", role: "assistant", agent: "yolo" } as any,
      },
    }
    await taskContinuation.handler({ event: assistantMessageEvent })

    // Advance time past the countdown
    await vi.advanceTimersByTimeAsync(3000)

    // Countdown should have fired
    expect(ctx.client.session.prompt).toHaveBeenCalled()
  })

  it("should complete full flow: idle → countdown → message update (no cancel) → continuation", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(1, 2))

    const taskContinuation = createTaskContinuation(ctx, { countdownSeconds: 2 })

    // 1. Session goes idle with incomplete todos
    await taskContinuation.handler({ event: createIdleEvent("session-456") })
    expect(ctx.client.tui.showToast).toHaveBeenCalled()

    // 2. Advance time to just before countdown fires
    await vi.advanceTimersByTimeAsync(1500)

    // 3. Message gets updated with summary (simulating OpenCode behavior)
    const messageUpdateEvent: LoopEvent = {
      type: "message.updated",
      properties: {
        sessionID: "session-456",
        info: {
          id: "msg-1",
          sessionID: "session-456",
          role: "user",
          summary: { title: "Creating todos" },
        } as any,
      },
    }
    await taskContinuation.handler({ event: messageUpdateEvent })

    // 4. Advance time past countdown
    await vi.advanceTimersByTimeAsync(2000)

    // 5. Continuation should be injected (countdown not cancelled by message update)
    expect(ctx.client.session.prompt).toHaveBeenCalled()

    // Verify continuation prompt content
    const promptCall = (ctx.client.session.prompt as any).mock.calls[0][0] as PromptCall
    expect(promptCall.body.parts[0].text).toContain("AUTO-CONTINUATION")
    expect(promptCall.body.parts[0].text).toContain("incomplete task")
  })

  it("should handle rapid message updates without cancelling countdown", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(0, 1))

    const taskContinuation = createTaskContinuation(ctx, { countdownSeconds: 2 })

    // Trigger idle
    await taskContinuation.handler({ event: createIdleEvent("session-789") })
    expect(ctx.client.tui.showToast).toHaveBeenCalled()

    // Simulate multiple rapid message updates (as OpenCode sends)
    const messageUpdates = [
      { id: "msg-1", summary: { title: "Creating task" } },
      { id: "msg-1", summary: { title: "Creating task", diffs: [] } },
      { id: "msg-1", summary: { title: "Creating task", diffs: [], created: Date.now() } },
    ]

    for (const update of messageUpdates) {
      const event: LoopEvent = {
        type: "message.updated",
        properties: {
          sessionID: "session-789",
          info: { ...update, sessionID: "session-789", role: "user" } as any,
        },
      }
      await taskContinuation.handler({ event })
    }

    // Advance time past countdown
    await vi.advanceTimersByTimeAsync(3000)

    // Countdown should have fired despite multiple message updates
    expect(ctx.client.session.prompt).toHaveBeenCalled()
  })
})
