/**
 * Tests for IterationLoop functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { createIterationLoop } from "../iteration-loop"
import type { PluginContext, LoopEvent, IterationLoopState } from "../types"
import * as fs from "node:fs"
import * as path from "node:path"

// Mock the node:fs module
vi.mock("node:fs")

describe("IterationLoop", () => {
  let mockContext: PluginContext
  let mockPromptFn: ReturnType<typeof vi.fn>
  let mockShowToastFn: ReturnType<typeof vi.fn>
  let mockReadFileSync: ReturnType<typeof vi.fn>
  let mockExistsSync: ReturnType<typeof vi.fn>
  let mockWriteFileSync: ReturnType<typeof vi.fn>
  let mockUnlinkSync: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetAllMocks()
    
    // Setup mock functions
    mockPromptFn = vi.fn().mockResolvedValue(undefined)
    mockShowToastFn = vi.fn().mockResolvedValue(undefined)
    mockReadFileSync = vi.fn()
    mockExistsSync = vi.fn()
    mockWriteFileSync = vi.fn()
    mockUnlinkSync = vi.fn()

    // Mock fs module
    vi.spyOn(fs, "readFileSync").mockImplementation(mockReadFileSync)
    vi.spyOn(fs, "existsSync").mockImplementation(mockExistsSync)
    vi.spyOn(fs, "writeFileSync").mockImplementation(mockWriteFileSync)
    vi.spyOn(fs, "unlinkSync").mockImplementation(mockUnlinkSync)

    // Create mock context
    mockContext = {
      directory: "/test/directory",
      client: {
        session: {
          prompt: mockPromptFn,
          todo: vi.fn().mockResolvedValue({ data: [] }),
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
    it("should create iteration loop with default options", () => {
      const iterationLoop = createIterationLoop(mockContext)

      expect(iterationLoop).toHaveProperty("handler")
      expect(iterationLoop).toHaveProperty("startLoop")
      expect(iterationLoop).toHaveProperty("cancelLoop")
      expect(iterationLoop).toHaveProperty("getState")
    })

    it("should create iteration loop with custom options", () => {
      const iterationLoop = createIterationLoop(mockContext, {
        defaultMaxIterations: 50,
        defaultCompletionMarker: "TASK_COMPLETE",
        stateFilePath: "custom/state.md",
      })

      expect(iterationLoop).toBeDefined()
    })
  })

  describe("startLoop", () => {
    it("should create state file when starting loop", () => {
      mockExistsSync.mockReturnValue(true)
      mockWriteFileSync.mockImplementation(() => {})

      const iterationLoop = createIterationLoop(mockContext)
      const result = iterationLoop.startLoop("session-123", "Build a REST API")

      expect(result).toBe(true)
      expect(mockWriteFileSync).toHaveBeenCalled()
    })

    it("should return false when write fails", () => {
      mockExistsSync.mockReturnValue(true)
      mockWriteFileSync.mockImplementation(() => {
        throw new Error("Write failed")
      })

      const iterationLoop = createIterationLoop(mockContext)
      const result = iterationLoop.startLoop("session-123", "Build a REST API")

      expect(result).toBe(false)
    })

    it("should create directory if it does not exist", () => {
      mockExistsSync
        .mockReturnValueOnce(false) // directory check
        .mockReturnValue(true) // subsequent checks
      const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => {})
      mockWriteFileSync.mockImplementation(() => {})

      const iterationLoop = createIterationLoop(mockContext)
      iterationLoop.startLoop("session-123", "Build a REST API")

      expect(mkdirSpy).toHaveBeenCalled()
    })

    it("should use custom max iterations when provided", () => {
      mockExistsSync.mockReturnValue(true)
      mockWriteFileSync.mockImplementation(() => {})

      const iterationLoop = createIterationLoop(mockContext)
      iterationLoop.startLoop("session-123", "Build a REST API", {
        maxIterations: 20,
      })

      const writtenContent = mockWriteFileSync.mock.calls[0][1] as string
      expect(writtenContent).toContain("max_iterations: 20")
    })

    it("should use custom completion marker when provided", () => {
      mockExistsSync.mockReturnValue(true)
      mockWriteFileSync.mockImplementation(() => {})

      const iterationLoop = createIterationLoop(mockContext)
      iterationLoop.startLoop("session-123", "Build a REST API", {
        completionMarker: "API_READY",
      })

      const writtenContent = mockWriteFileSync.mock.calls[0][1] as string
      expect(writtenContent).toContain('completion_marker: "API_READY"')
    })
  })

  describe("cancelLoop", () => {
    it("should remove state file when cancelling loop", () => {
      // Setup existing state
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`---
active: true
iteration: 5
max_iterations: 100
completion_marker: "DONE"
started_at: "2024-01-01T00:00:00.000Z"
session_id: "session-123"
---
Prompt`)
      mockUnlinkSync.mockImplementation(() => {})

      const iterationLoop = createIterationLoop(mockContext)
      const result = iterationLoop.cancelLoop("session-123")

      expect(result).toBe(true)
      expect(mockUnlinkSync).toHaveBeenCalled()
    })

    it("should return false when no active loop exists", () => {
      mockExistsSync.mockReturnValue(false)

      const iterationLoop = createIterationLoop(mockContext)
      const result = iterationLoop.cancelLoop("session-123")

      expect(result).toBe(false)
    })

    it("should return false when session ID does not match", () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`---
active: true
iteration: 5
max_iterations: 100
completion_marker: "DONE"
started_at: "2024-01-01T00:00:00.000Z"
session_id: "different-session"
---
Prompt`)

      const iterationLoop = createIterationLoop(mockContext)
      const result = iterationLoop.cancelLoop("session-123")

      expect(result).toBe(false)
      expect(mockUnlinkSync).not.toHaveBeenCalled()
    })
  })

  describe("getState", () => {
    it("should return current loop state", () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`---
active: true
iteration: 3
max_iterations: 100
completion_marker: "DONE"
started_at: "2024-01-01T00:00:00.000Z"
session_id: "session-123"
---
Prompt`)

      const iterationLoop = createIterationLoop(mockContext)
      const state = iterationLoop.getState()

      expect(state).not.toBeNull()
      expect(state!.iteration).toBe(3)
      expect(state!.session_id).toBe("session-123")
    })

    it("should return null when no state exists", () => {
      mockExistsSync.mockReturnValue(false)

      const iterationLoop = createIterationLoop(mockContext)
      const state = iterationLoop.getState()

      expect(state).toBeNull()
    })
  })

  describe("handler - session.idle", () => {
    it("should continue loop when no completion marker detected", async () => {
      // Setup initial state
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`---
active: true
iteration: 1
max_iterations: 100
completion_marker: "DONE"
started_at: "2024-01-01T00:00:00.000Z"
session_id: "session-123"
---
Prompt`)

      const iterationLoop = createIterationLoop(mockContext)
      
      const event: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }

      await iterationLoop.handler({ event })

      expect(mockPromptFn).toHaveBeenCalled()
    })

    it("should stop loop when completion marker is detected", async () => {
      // Setup state and transcript with completion marker
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`---
active: true
iteration: 5
max_iterations: 100
completion_marker: "DONE"
started_at: "2024-01-01T00:00:00.000Z"
session_id: "session-123"
---
Prompt`)
      // Return different content for transcript check
      mockReadFileSync.mockReturnValueOnce(`---
active: true
iteration: 5
max_iterations: 100
completion_marker: "DONE"
started_at: "2024-01-01T00:00:00.000Z"
session_id: "session-123"
---
Prompt`).mockReturnValueOnce("Transcript with <completion>DONE</completion> marker")

      const iterationLoop = createIterationLoop(mockContext)
      
      const event: LoopEvent = {
        type: "session.idle",
        properties: { 
          sessionID: "session-123",
          transcriptPath: "/path/to/transcript.txt",
        },
      }

      await iterationLoop.handler({ event })

      expect(mockUnlinkSync).toHaveBeenCalled()
      expect(mockShowToastFn).toHaveBeenCalled()
      expect(mockPromptFn).not.toHaveBeenCalled()
    })

    it("should stop loop at max iterations", async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`---
active: true
iteration: 100
max_iterations: 100
completion_marker: "DONE"
started_at: "2024-01-01T00:00:00.000Z"
session_id: "session-123"
---
Prompt`)

      const iterationLoop = createIterationLoop(mockContext)
      
      const event: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }

      await iterationLoop.handler({ event })

      expect(mockUnlinkSync).toHaveBeenCalled()
      expect(mockShowToastFn).toHaveBeenCalled()
      expect(mockPromptFn).not.toHaveBeenCalled()
    })

    it("should continue loop without completion marker", async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`---
active: true
iteration: 2
max_iterations: 100
completion_marker: "DONE"
started_at: "2024-01-01T00:00:00.000Z"
session_id: "session-123"
---
Prompt`)
      // Return content without completion marker
      mockReadFileSync.mockReturnValueOnce(`---
active: true
iteration: 2
max_iterations: 100
completion_marker: "DONE"
started_at: "2024-01-01T00:00:00.000Z"
session_id: "session-123"
---
Prompt`).mockReturnValueOnce("Transcript without completion marker")

      const iterationLoop = createIterationLoop(mockContext)
      
      const event: LoopEvent = {
        type: "session.idle",
        properties: { 
          sessionID: "session-123",
          transcriptPath: "/path/to/transcript.txt",
        },
      }

      await iterationLoop.handler({ event })

      expect(mockPromptFn).toHaveBeenCalled()
    })

    it("should not process when session ID does not match", async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`---
active: true
iteration: 1
max_iterations: 100
completion_marker: "DONE"
started_at: "2024-01-01T00:00:00.000Z"
session_id: "different-session"
---
Prompt`)

      const iterationLoop = createIterationLoop(mockContext)
      
      const event: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }

      await iterationLoop.handler({ event })

      expect(mockPromptFn).not.toHaveBeenCalled()
    })
  })

  describe("handler - session.deleted", () => {
    it("should clear loop state on session deletion", async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`---
active: true
iteration: 5
max_iterations: 100
completion_marker: "DONE"
started_at: "2024-01-01T00:00:00.000Z"
session_id: "session-123"
---
Prompt`)

      const iterationLoop = createIterationLoop(mockContext)
      
      const event: LoopEvent = {
        type: "session.deleted",
        properties: { info: { id: "session-123" } },
      }

      await iterationLoop.handler({ event })

      expect(mockUnlinkSync).toHaveBeenCalled()
    })

    it("should not clear loop for different session", async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`---
active: true
iteration: 5
max_iterations: 100
completion_marker: "DONE"
started_at: "2024-01-01T00:00:00.000Z"
session_id: "session-123"
---
Prompt`)

      const iterationLoop = createIterationLoop(mockContext)
      
      const event: LoopEvent = {
        type: "session.deleted",
        properties: { info: { id: "different-session" } },
      }

      await iterationLoop.handler({ event })

      expect(mockUnlinkSync).not.toHaveBeenCalled()
    })
  })

  describe("handler - session.error", () => {
    it("should mark session as recovering briefly", async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue(`---
active: true
iteration: 1
max_iterations: 100
completion_marker: "DONE"
started_at: "2024-01-01T00:00:00.000Z"
session_id: "session-123"
---
Prompt`)

      const iterationLoop = createIterationLoop(mockContext)
      
      const errorEvent: LoopEvent = {
        type: "session.error",
        properties: { sessionID: "session-123" },
      }
      await iterationLoop.handler({ event: errorEvent })

      // Should not continue due to recovery
      const idleEvent: LoopEvent = {
        type: "session.idle",
        properties: { sessionID: "session-123" },
      }
      await iterationLoop.handler({ event: idleEvent })

      expect(mockPromptFn).not.toHaveBeenCalled()
    })
  })
})
