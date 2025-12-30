/**
 * Tests for utility functions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  parseFrontmatter,
  isAbortError,
  readLoopState,
  writeLoopState,
  clearLoopState,
  incrementIteration,
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

      expect(result.data).toEqual({})
      expect(result.body).toBe("")
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

      expect(result.data).toEqual({ title: "" })
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
      expect(isAbortError(error)).toBe(false)
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

    const result = readLoopState(testDirectory, customPath)

    expect(fs.existsSync).toHaveBeenCalledWith(
      path.join(testDirectory, customPath)
    )
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

    expect(unlinkSpy).toHaveBeenCalledWith(
      path.join(testDirectory, customPath)
    )
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
