/**
 * Shared test setup and utilities for goal management tests
 */

import { vi } from "vitest"
import * as fs from "node:fs/promises"

// Mock the fs module before importing anything that uses it
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}))

// Import the actual types and functions from the codebase
import type { Goal, PluginContext } from "../types.js"


// Mock path module for path operations
vi.mock("node:path", () => ({
  dirname: vi.fn((p: string) => p.replace(/\/[^/]+$/, "")),
}))

// Create a mock PluginContext for testing
export function createMockPluginContext(): PluginContext {
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
export function createMockFileSystem(): MockFileSystemContext {
  return {
    basePath: "/test/directory/.goals",
    goalsFile: "/test/directory/.goals/session-123/goal.json",
    storedGoal: null,
    writeCalls: [],
  }
}

// Setup mock file system operations
export function setupMockFileSystem(ctx: MockFileSystemContext) {
  vi.mocked(fs.readFile).mockReset()
  vi.mocked(fs.writeFile).mockReset()
  vi.mocked(fs.mkdir).mockReset()

  // Storage for goals from any session
  const sessionGoals = new Map<string, Goal>()

  vi.mocked(fs.readFile).mockImplementation(async (filePath, _encoding) => {
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

  vi.mocked(fs.writeFile).mockImplementation(async (filePath, data, _encoding) => {
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