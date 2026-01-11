import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { PluginContext, Todo, LoopEvent } from "../types.js"
import { createTaskContinuation } from "../index.ts"

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
    on: vi.fn(),
  } as unknown as PluginContext
}

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

function createIdleEvent(sessionID: string): LoopEvent {
  return {
    type: "session.idle",
    properties: { sessionID },
  }
}

describe("CleanupTest", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("should inject continuation when incomplete todos remain (simplified)", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(1, 2))

    const taskContinuation = createTaskContinuation(ctx)
    await taskContinuation.handler({ event: createIdleEvent("session-123") })

    await vi.advanceTimersByTimeAsync(3000)
    expect(ctx.client.session.prompt).toHaveBeenCalled()
  })

  it("should not inject continuation when all todos are completed", async () => {
    const ctx = createMockContext()
    const mockTodoFn = ctx.client.session.todo as unknown as {
      mockResolvedValue: (val: Todo[]) => void
    }
    mockTodoFn.mockResolvedValue(createMockTodos(5, 0))

    const taskContinuation = createTaskContinuation(ctx)
    await taskContinuation.handler({ event: createIdleEvent("session-completed") })

    await vi.advanceTimersByTimeAsync(3000)
    expect(ctx.client.session.prompt).not.toHaveBeenCalled()
  })
})
