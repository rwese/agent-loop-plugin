/**
 * Tests for utility functions
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  parseFrontmatter,
  isAbortError,
  readLoopState,
  writeLoopState,
  clearLoopState,
  incrementIteration,
  writeOutput,
  clearOutput,
  getOutputFilePath,
  createFileLogger,
  sendIgnoredMessage,
  generateCodename,
  createLogger,
} from "../utils"
import * as fs from "node:fs"
import * as path from "node:path"

// Mock the node:fs module
vi.mock("node:fs")

describe("parseFrontmatter", () => {
  describe("valid frontmatter", () => {
    it("should parse frontmatter with string values", () => {
      const content = `---
title: "Test Title"
author: "John Doe"
---
# Main Content`

      const result = parseFrontmatter(content)

      expect(result.data).toEqual({
        title: "Test Title",
        author: "John Doe",
      })
      expect(result.body).toBe("# Main Content")
    })

    it("should parse frontmatter with boolean values", () => {
      const content = `---
active: true
disabled: false
---
Content here`

      const result = parseFrontmatter(content)

      expect(result.data).toEqual({
        active: true,
        disabled: false,
      })
    })

    it("should parse frontmatter with numeric values", () => {
      const content = `---
count: 42
ratio: 3.14
---
Content here`

      const result = parseFrontmatter(content)

      expect(result.data).toEqual({
        count: 42,
        ratio: 3.14,
      })
    })

    it("should handle mixed value types", () => {
      const content = `---
name: "Test"
enabled: true
count: 10
---
Body content`

      const result = parseFrontmatter(content)

      expect(result.data).toEqual({
        name: "Test",
        enabled: true,
        count: 10,
      })
    })
  })

  describe("invalid frontmatter", () => {
    it("should return empty data when no frontmatter exists", () => {
      const content = `# Just content without frontmatter`

      const result = parseFrontmatter(content)

      expect(result.data).toEqual({})
      expect(result.body).toBe("# Just content without frontmatter")
    })

    it("should handle incomplete frontmatter", () => {
      const content = `---
title: "Test"
incomplete frontmatter
---
Content`

      const result = parseFrontmatter(content)

      expect(result.data).toEqual({ title: "Test" })
      expect(result.body).toBe("Content")
    })

    it("should handle frontmatter without closing delimiter", () => {
      const content = `---
title: "Test"
Content here`

      const result = parseFrontmatter(content)

      expect(result.data).toEqual({})
      expect(result.body).toBe(content)
    })
  })

  describe("empty content", () => {
    it("should handle empty string", () => {
      const result = parseFrontmatter("")

      expect(result.data).toEqual({})
      expect(result.body).toBe("")
    })

    it("should handle content with only frontmatter delimiters", () => {
      const content = `---

---`

      const result = parseFrontmatter(content)

      // Content without proper frontmatter format returns original content as body
      expect(result.data).toEqual({})
      expect(result.body).toBe(content)
    })
  })

  describe("edge cases", () => {
    it("should handle frontmatter with CRLF line endings", () => {
      const content = `---\r\ntitle: "Test"\r\n---\r\nContent`

      const result = parseFrontmatter(content)

      expect(result.data).toEqual({ title: "Test" })
      expect(result.body).toBe("Content")
    })

    it("should handle empty values", () => {
      const content = `---
title: ""
author:
---
Content`

      const result = parseFrontmatter(content)

      // Both title and author are parsed, author has empty string value
      expect(result.data).toEqual({ title: "", author: "" })
    })
  })
})

describe("isAbortError", () => {
  describe("null/undefined inputs", () => {
    it("should return false for null", () => {
      expect(isAbortError(null)).toBe(false)
    })

    it("should return false for undefined", () => {
      expect(isAbortError(undefined)).toBe(false)
    })
  })

  describe("AbortError types", () => {
    it("should detect MessageAbortedError", () => {
      const error = new Error("Message was aborted")
      error.name = "MessageAbortedError"
      expect(isAbortError(error)).toBe(true)
    })

    it("should detect AbortError", () => {
      const error = new Error("Aborted")
      error.name = "AbortError"
      expect(isAbortError(error)).toBe(true)
    })

    it("should detect DOMException with abort in message", () => {
      const error = new DOMException("Aborted by user", "AbortError")
      expect(isAbortError(error)).toBe(true)
    })
  })

  describe("message-based detection", () => {
    it("should detect 'aborted' in message", () => {
      const error = new Error("Request was aborted")
      expect(isAbortError(error)).toBe(true)
    })

    it("should detect 'cancelled' in message (case insensitive)", () => {
      expect(isAbortError(new Error("Operation CANCELLED"))).toBe(true)
      expect(isAbortError(new Error("Operation cancelled"))).toBe(true)
    })

    it("should detect 'interrupted' in message", () => {
      const error = new Error("Process interrupted")
      expect(isAbortError(error)).toBe(true)
    })
  })

  describe("string error inputs", () => {
    it("should detect abort in string error", () => {
      expect(isAbortError("Operation abort")).toBe(true)
    })

    it("should detect cancel in string error", () => {
      expect(isAbortError("Operation cancel")).toBe(true)
    })

    it("should detect interrupt in string error", () => {
      expect(isAbortError("Operation interrupt")).toBe(true)
    })

    it("should return false for non-matching string", () => {
      expect(isAbortError("Normal error message")).toBe(false)
    })
  })

  describe("edge cases", () => {
    it("should handle object without name property", () => {
      const error = { message: "operation was aborted" }
      expect(isAbortError(error)).toBe(true)
    })

    it("should handle object with empty message", () => {
      const error = new Error("")
      error.name = "AbortError"
      // AbortError is detected by name even with empty message
      expect(isAbortError(error)).toBe(true)
    })
  })
})

describe("readLoopState", () => {
  const testDirectory = "/test/directory"

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("should return null when file does not exist", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false)

    const result = readLoopState(testDirectory)

    expect(result).toBeNull()
  })

  it("should return null when file exists but is invalid", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    vi.spyOn(fs, "readFileSync").mockReturnValue("invalid content")

    const result = readLoopState(testDirectory)

    expect(result).toBeNull()
  })

  it("should return null when required fields are missing", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    vi.spyOn(fs, "readFileSync").mockReturnValue(`---
title: "Test"
---
Content`)

    const result = readLoopState(testDirectory)

    expect(result).toBeNull()
  })

  it("should return parsed state with valid content", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    vi.spyOn(fs, "readFileSync").mockReturnValue(`---
active: true
iteration: 5
max_iterations: 100
completion_marker: "DONE"
started_at: "2024-01-01T00:00:00.000Z"
session_id: "session-123"
---
Test prompt`)

    const result = readLoopState(testDirectory)

    expect(result).not.toBeNull()
    expect(result!.active).toBe(true)
    expect(result!.iteration).toBe(5)
    expect(result!.max_iterations).toBe(100)
    expect(result!.completion_marker).toBe("DONE")
    expect(result!.prompt).toBe("Test prompt")
    expect(result!.session_id).toBe("session-123")
  })

  it("should handle string boolean values", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    vi.spyOn(fs, "readFileSync").mockReturnValue(`---
active: "true"
iteration: "3"
max_iterations: "50"
completion_marker: "TEST"
started_at: "2024-01-01T00:00:00.000Z"
---
Prompt`)

    const result = readLoopState(testDirectory)

    expect(result).not.toBeNull()
    expect(result!.active).toBe(true)
    expect(result!.iteration).toBe(3)
  })

  it("should use default values for missing optional fields", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    vi.spyOn(fs, "readFileSync").mockReturnValue(`---
active: true
iteration: 1
---
Prompt`)

    const result = readLoopState(testDirectory)

    expect(result).not.toBeNull()
    expect(result!.max_iterations).toBe(100)
    expect(result!.completion_marker).toBe("DONE")
    expect(result!.session_id).toBeUndefined()
  })

  it("should handle custom state file path", () => {
    const customPath = "custom/state.md"
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    vi.spyOn(fs, "readFileSync").mockReturnValue(`---
active: true
iteration: 1
---
Prompt`)

    readLoopState(testDirectory, customPath)

    expect(fs.existsSync).toHaveBeenCalledWith(path.join(testDirectory, customPath))
  })
})

describe("writeLoopState", () => {
  const testDirectory = "/test/directory"

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("should return false on write failure", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw new Error("Write failed")
    })

    const state = {
      active: true,
      iteration: 1,
      max_iterations: 100,
      completion_marker: "DONE",
      started_at: new Date().toISOString(),
      prompt: "Test",
    }

    const result = writeLoopState(testDirectory, state)

    expect(result).toBe(false)
  })

  it("should create directory if it does not exist", () => {
    vi.spyOn(fs, "existsSync")
      .mockReturnValueOnce(false) // dir check
      .mockReturnValue(true) // file exists check
    const mkdirSpy = vi.spyOn(fs, "mkdirSync")
    vi.spyOn(fs, "writeFileSync")

    const state = {
      active: true,
      iteration: 1,
      max_iterations: 100,
      completion_marker: "DONE",
      started_at: new Date().toISOString(),
      prompt: "Test",
    }

    writeLoopState(testDirectory, state)

    expect(mkdirSpy).toHaveBeenCalled()
  })

  it("should return true on successful write", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    const writeSpy = vi.spyOn(fs, "writeFileSync")

    const state = {
      active: true,
      iteration: 1,
      max_iterations: 100,
      completion_marker: "DONE",
      started_at: new Date().toISOString(),
      prompt: "Test",
    }

    const result = writeLoopState(testDirectory, state)

    expect(result).toBe(true)
    expect(writeSpy).toHaveBeenCalled()
  })

  it("should include session_id when present", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    const writeSpy = vi.spyOn(fs, "writeFileSync")

    const state = {
      active: true,
      iteration: 1,
      max_iterations: 100,
      completion_marker: "DONE",
      started_at: new Date().toISOString(),
      prompt: "Test",
      session_id: "session-123",
    }

    writeLoopState(testDirectory, state)

    const writtenContent = writeSpy.mock.calls[0][1] as string
    expect(writtenContent).toContain('session_id: "session-123"')
  })
})

describe("clearLoopState", () => {
  const testDirectory = "/test/directory"

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("should return true when file does not exist", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false)

    const result = clearLoopState(testDirectory)

    expect(result).toBe(true)
  })

  it("should return true on successful deletion", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    const unlinkSpy = vi.spyOn(fs, "unlinkSync")

    const result = clearLoopState(testDirectory)

    expect(result).toBe(true)
    expect(unlinkSpy).toHaveBeenCalled()
  })

  it("should return false on deletion failure", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw new Error("Delete failed")
    })

    const result = clearLoopState(testDirectory)

    expect(result).toBe(false)
  })

  it("should use custom state file path", () => {
    const customPath = "custom/state.md"
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    const unlinkSpy = vi.spyOn(fs, "unlinkSync")

    clearLoopState(testDirectory, customPath)

    expect(unlinkSpy).toHaveBeenCalledWith(path.join(testDirectory, customPath))
  })
})

describe("incrementIteration", () => {
  const testDirectory = "/test/directory"

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("should return null when state does not exist", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false)

    const result = incrementIteration(testDirectory)

    expect(result).toBeNull()
  })

  it("should increment iteration and write state", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    vi.spyOn(fs, "readFileSync").mockReturnValue(`---
active: true
iteration: 5
max_iterations: 100
completion_marker: "DONE"
started_at: "2024-01-01T00:00:00.000Z"
---
Prompt`)

    const result = incrementIteration(testDirectory)

    expect(result).not.toBeNull()
    expect(result!.iteration).toBe(6)
  })
})

describe("getOutputFilePath", () => {
  it("should return default path when no custom path provided", () => {
    const result = getOutputFilePath("/test/directory")
    expect(result).toBe("/test/directory/.agent-loop/output.log")
  })

  it("should use custom path when provided", () => {
    const result = getOutputFilePath("/test/directory", "custom/output.log")
    expect(result).toBe("/test/directory/custom/output.log")
  })
})

describe("writeOutput", () => {
  const testDirectory = "/test/directory"

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("should create directory if it does not exist", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false)
    const mkdirSpy = vi.spyOn(fs, "mkdirSync")
    vi.spyOn(fs, "appendFileSync")

    writeOutput(testDirectory, "Test message")

    expect(mkdirSpy).toHaveBeenCalled()
  })

  it("should append message to file", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    const appendSpy = vi.spyOn(fs, "appendFileSync")

    writeOutput(testDirectory, "Test message")

    expect(appendSpy).toHaveBeenCalled()
    const writtenContent = appendSpy.mock.calls[0][1] as string
    expect(writtenContent).toContain("Test message")
  })

  it("should include data in output", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    const appendSpy = vi.spyOn(fs, "appendFileSync")

    writeOutput(testDirectory, "Test message", { key: "value" })

    const writtenContent = appendSpy.mock.calls[0][1] as string
    expect(writtenContent).toContain("Test message")
    expect(writtenContent).toContain('"key":"value"')
  })

  it("should return false on write failure", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    vi.spyOn(fs, "appendFileSync").mockImplementation(() => {
      throw new Error("Write failed")
    })

    const result = writeOutput(testDirectory, "Test message")

    expect(result).toBe(false)
  })

  it("should return true on successful write", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    vi.spyOn(fs, "appendFileSync")

    const result = writeOutput(testDirectory, "Test message")

    expect(result).toBe(true)
  })
})

describe("clearOutput", () => {
  const testDirectory = "/test/directory"

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("should return true when file does not exist", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false)

    const result = clearOutput(testDirectory)

    expect(result).toBe(true)
  })

  it("should delete file when it exists", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    const unlinkSpy = vi.spyOn(fs, "unlinkSync")

    const result = clearOutput(testDirectory)

    expect(result).toBe(true)
    expect(unlinkSpy).toHaveBeenCalled()
  })

  it("should return false on deletion failure", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    vi.spyOn(fs, "unlinkSync").mockImplementation(() => {
      throw new Error("Delete failed")
    })

    const result = clearOutput(testDirectory)

    expect(result).toBe(false)
  })
})

describe("createFileLogger", () => {
  const testDirectory = "/test/directory"

  beforeEach(() => {
    vi.resetAllMocks()
    vi.spyOn(fs, "existsSync").mockReturnValue(true)
    vi.spyOn(fs, "appendFileSync")
  })

  it("should create logger with all methods", () => {
    const logger = createFileLogger(testDirectory)

    expect(logger).toHaveProperty("debug")
    expect(logger).toHaveProperty("info")
    expect(logger).toHaveProperty("warn")
    expect(logger).toHaveProperty("error")
  })

  it("should write info messages", () => {
    const appendSpy = vi.spyOn(fs, "appendFileSync")
    const logger = createFileLogger(testDirectory)

    logger.info("Test info message")

    expect(appendSpy).toHaveBeenCalled()
    const writtenContent = appendSpy.mock.calls[0][1] as string
    expect(writtenContent).toContain("[INFO]")
    expect(writtenContent).toContain("Test info message")
  })

  it("should not write debug messages at info level", () => {
    const appendSpy = vi.spyOn(fs, "appendFileSync")
    const logger = createFileLogger(testDirectory, undefined, "info")

    logger.debug("Test debug message")

    expect(appendSpy).not.toHaveBeenCalled()
  })

  it("should write debug messages at debug level", () => {
    const appendSpy = vi.spyOn(fs, "appendFileSync")
    const logger = createFileLogger(testDirectory, undefined, "debug")

    logger.debug("Test debug message")

    expect(appendSpy).toHaveBeenCalled()
    const writtenContent = appendSpy.mock.calls[0][1] as string
    expect(writtenContent).toContain("[DEBUG]")
  })

  it("should write error messages", () => {
    const appendSpy = vi.spyOn(fs, "appendFileSync")
    const logger = createFileLogger(testDirectory)

    logger.error("Test error message")

    expect(appendSpy).toHaveBeenCalled()
    const writtenContent = appendSpy.mock.calls[0][1] as string
    expect(writtenContent).toContain("[ERROR]")
  })

  it("should use custom path", () => {
    const appendSpy = vi.spyOn(fs, "appendFileSync")
    const logger = createFileLogger(testDirectory, "custom/log.txt")

    logger.info("Test message")

    expect(appendSpy).toHaveBeenCalledWith(
      expect.stringContaining("custom/log.txt"),
      expect.any(String),
      "utf-8"
    )
  })
})

describe("sendIgnoredMessage", () => {
  it("should send message with agent and model options", async () => {
    const mockPrompt = vi.fn().mockResolvedValue(undefined)
    const client = {
      session: {
        prompt: mockPrompt,
      },
    }

    await sendIgnoredMessage(client, "session-123", "Test message", undefined, {
      agent: "test-agent",
      model: "test-model",
    })

    expect(mockPrompt).toHaveBeenCalledWith({
      path: { id: "session-123" },
      body: {
        agent: "test-agent",
        model: "test-model",
        noReply: true,
        parts: [
          {
            type: "text",
            text: "Test message",
            ignored: true,
          },
        ],
      },
    })
  })

  it("should send message without options", async () => {
    const mockPrompt = vi.fn().mockResolvedValue(undefined)
    const client = {
      session: {
        prompt: mockPrompt,
      },
    }

    await sendIgnoredMessage(client, "session-123", "Test message")

    expect(mockPrompt).toHaveBeenCalledWith({
      path: { id: "session-123" },
      body: {
        agent: undefined,
        model: undefined,
        noReply: true,
        parts: [
          {
            type: "text",
            text: "Test message",
            ignored: true,
          },
        ],
      },
    })
  })

  it("should log error on failure when logger provided", async () => {
    const mockPrompt = vi.fn().mockRejectedValue(new Error("Test error"))
    const client = {
      session: {
        prompt: mockPrompt,
      },
    }
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    await sendIgnoredMessage(client, "session-123", "Test message", mockLogger)

    expect(mockLogger.error).toHaveBeenCalledWith(
      "Failed to send ignored message",
      expect.objectContaining({
        error: "Test error",
        sessionID: "session-123",
      })
    )
  })
})

describe("generateCodename", () => {
  it("should generate a codename in ADJECTIVE_NOUN format", () => {
    const codename = generateCodename()
    expect(codename).toMatch(/^[A-Z]+_[A-Z]+$/)
  })

  it("should generate unique codenames on multiple calls", () => {
    const codenames = new Set<string>()
    // Generate 50 codenames and check for uniqueness (statistically should mostly be unique)
    for (let i = 0; i < 50; i++) {
      codenames.add(generateCodename())
    }
    // With 30x30=900 possible combinations, 50 samples should have at least 40 unique
    expect(codenames.size).toBeGreaterThan(40)
  })

  it("should only contain uppercase letters and underscore", () => {
    for (let i = 0; i < 20; i++) {
      const codename = generateCodename()
      expect(codename).toMatch(/^[A-Z_]+$/)
    }
  })
})

describe("createLogger", () => {
  it("should create logger with all methods", () => {
    const logger = createLogger()
    expect(logger).toHaveProperty("debug")
    expect(logger).toHaveProperty("info")
    expect(logger).toHaveProperty("warn")
    expect(logger).toHaveProperty("error")
  })

  it("should respect log levels - silent logs nothing", () => {
    const mockDebug = vi.fn()
    const mockInfo = vi.fn()
    const logger = createLogger({ debug: mockDebug, info: mockInfo }, "silent")

    logger.debug("test")
    logger.info("test")

    expect(mockDebug).not.toHaveBeenCalled()
    expect(mockInfo).not.toHaveBeenCalled()
  })

  it("should respect log levels - error only logs errors", () => {
    const mockInfo = vi.fn()
    const mockError = vi.fn()
    const logger = createLogger({ info: mockInfo, error: mockError }, "error")

    logger.info("test")
    logger.error("test")

    expect(mockInfo).not.toHaveBeenCalled()
    expect(mockError).toHaveBeenCalled()
  })

  it("should log with data object", () => {
    const mockInfo = vi.fn()
    const logger = createLogger({ info: mockInfo }, "info")

    logger.info("test message", { key: "value" })

    expect(mockInfo).toHaveBeenCalled()
    const loggedMessage = mockInfo.mock.calls[0][0]
    expect(loggedMessage).toContain("test message")
    expect(loggedMessage).toContain("key")
    expect(loggedMessage).toContain("value")
  })
})
