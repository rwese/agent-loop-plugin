/**
 * Mock helpers for agent-loop tests
 */

import type { PluginContext, Todo, IterationLoopState } from "../types"
import { vi } from "vitest"

/**
 * Create a mock PluginContext with all required methods
 */
export function createMockPluginContext(overrides: Partial<PluginContext> = {}): PluginContext {
  return {
    directory: "/mock/directory",
    client: {
      session: {
        id: "mock-session-id",
        get: vi.fn().mockResolvedValue({
          id: "mock-session-id",
          agent: "test-agent",
          model: "test-model",
        }),
        messages: vi.fn().mockResolvedValue([]),
        prompt: vi.fn().mockResolvedValue(undefined),
        todo: vi.fn().mockResolvedValue({ data: [] }),
      },
      tui: {
        showToast: vi.fn().mockResolvedValue(undefined),
      },
    },
    ...overrides,
  }
}

/**
 * Create a mock PluginContext with specific todos
 */
export function createMockPluginContextWithTodos(todos: Todo[]): PluginContext {
  return createMockPluginContext({
    client: {
      session: {
        id: "mock-session-id",
        get: vi.fn().mockResolvedValue({
          id: "mock-session-id",
          agent: "test-agent",
          model: "test-model",
        }),
        messages: vi.fn().mockResolvedValue([]),
        prompt: vi.fn().mockResolvedValue(undefined),
        todo: vi.fn().mockResolvedValue({ data: todos }),
      },
      tui: {
        showToast: vi.fn().mockResolvedValue(undefined),
      },
    },
  })
}

/**
 * Mock file system operations
 */
export const mockFs = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
}

/**
 * Setup file system mocks
 */
export function setupFileSystemMocks() {
  vi.mock("node:fs", () => ({
    existsSync: mockFs.existsSync,
    readFileSync: mockFs.readFileSync,
    writeFileSync: mockFs.writeFileSync,
    unlinkSync: mockFs.unlinkSync,
    mkdirSync: mockFs.mkdirSync,
  }))
}

/**
 * Create a sample iteration loop state for testing
 */
export function createMockIterationLoopState(
  overrides: Partial<IterationLoopState> = {}
): IterationLoopState {
  return {
    active: true,
    iteration: 1,
    max_iterations: 100,
    completion_marker: "DONE",
    started_at: "2024-01-01T00:00:00.000Z",
    prompt: "Test prompt",
    session_id: "session-123",
    ...overrides,
  }
}

/**
 * Create sample todos for testing
 */
export function createMockTodos(overrides: Partial<Todo>[] = []): Todo[] {
  const defaultTodos: Todo[] = [
    { id: "1", content: "Task 1", status: "pending", priority: "high" },
    { id: "2", content: "Task 2", status: "in_progress", priority: "medium" },
    { id: "3", content: "Task 3", status: "completed", priority: "low" },
  ]
  return overrides.length > 0
    ? defaultTodos.map((todo, index) => ({ ...todo, ...overrides[index] }))
    : defaultTodos
}

/**
 * Create an incomplete todos array
 */
export function createIncompleteTodos(): Todo[] {
  return [
    { id: "1", content: "Task 1", status: "pending", priority: "high" },
    { id: "2", content: "Task 2", status: "in_progress", priority: "medium" },
  ]
}

/**
 * Create a completed todos array
 */
export function createCompletedTodos(): Todo[] {
  return [
    { id: "1", content: "Task 1", status: "completed", priority: "high" },
    { id: "2", content: "Task 2", status: "completed", priority: "medium" },
  ]
}

/**
 * Advance fake timers by specified seconds
 */
export function advanceTimers(seconds: number) {
  vi.advanceTimersByTime(seconds * 1000)
}

/**
 * Run all pending timers
 */
export function runAllTimers() {
  vi.runAllTimers()
}
