import { describe, it, expect } from "vitest"
import { parseIterationLoopTag, buildIterationStartPrompt } from "../prompt-parser.js"

describe("parseIterationLoopTag", () => {
  describe("basic tag parsing", () => {
    it("should parse a simple iteration loop tag", () => {
      const result = parseIterationLoopTag(`
        <iterationLoop>
        Build a REST API
        </iterationLoop>
      `)

      expect(result.found).toBe(true)
      expect(result.task).toBe("Build a REST API")
      expect(result.maxIterations).toBeUndefined()
      expect(result.marker).toBeUndefined()
      expect(result.cleanedPrompt).toBe("")
    })

    it("should parse tag with max attribute", () => {
      const result = parseIterationLoopTag(`
        <iterationLoop max="20">
        Refactor the database
        </iterationLoop>
      `)

      expect(result.found).toBe(true)
      expect(result.task).toBe("Refactor the database")
      expect(result.maxIterations).toBe(20)
      expect(result.marker).toBeUndefined()
    })

    it("should parse tag with both max and marker attributes", () => {
      const result = parseIterationLoopTag(`
        <iterationLoop max="15" marker="DEPLOYED">
        Deploy to production
        </iterationLoop>
      `)

      expect(result.found).toBe(true)
      expect(result.task).toBe("Deploy to production")
      expect(result.maxIterations).toBe(15)
      expect(result.marker).toBe("DEPLOYED")
    })

    it("should parse tag with marker before max", () => {
      const result = parseIterationLoopTag(`
        <iterationLoop marker="COMPLETE" max="10">
        Fix all bugs
        </iterationLoop>
      `)

      expect(result.found).toBe(true)
      expect(result.task).toBe("Fix all bugs")
      expect(result.maxIterations).toBe(10)
      expect(result.marker).toBe("COMPLETE")
    })
  })

  describe("self-closing tag parsing", () => {
    it("should parse self-closing tag with task attribute", () => {
      const result = parseIterationLoopTag(`
        <iterationLoop task="Build API" max="20" />
      `)

      expect(result.found).toBe(true)
      expect(result.task).toBe("Build API")
      expect(result.maxIterations).toBe(20)
    })

    it("should parse self-closing tag with all attributes", () => {
      const result = parseIterationLoopTag(`
        <iterationLoop task="Deploy app" max="10" marker="LIVE" />
      `)

      expect(result.found).toBe(true)
      expect(result.task).toBe("Deploy app")
      expect(result.maxIterations).toBe(10)
      expect(result.marker).toBe("LIVE")
    })
  })

  describe("prompt cleaning", () => {
    it("should preserve surrounding content in cleanedPrompt", () => {
      const result = parseIterationLoopTag(`
Please help me with this:

<iterationLoop max="20">
Build a REST API
</iterationLoop>

Thanks for your help!
      `)

      expect(result.found).toBe(true)
      expect(result.task).toBe("Build a REST API")
      expect(result.cleanedPrompt).toContain("Please help me with this:")
      expect(result.cleanedPrompt).toContain("Thanks for your help!")
      expect(result.cleanedPrompt).not.toContain("iterationLoop")
      expect(result.cleanedPrompt).not.toContain("Build a REST API")
    })

    it("should collapse multiple newlines after tag removal", () => {
      const result = parseIterationLoopTag(`
Before


<iterationLoop>Task</iterationLoop>


After
      `)

      expect(result.found).toBe(true)
      // Should not have more than 2 consecutive newlines
      expect(result.cleanedPrompt).not.toMatch(/\n{3,}/)
    })
  })

  describe("no tag present", () => {
    it("should return found=false when no tag present", () => {
      const prompt = "Just a regular prompt without any tags"
      const result = parseIterationLoopTag(prompt)

      expect(result.found).toBe(false)
      expect(result.cleanedPrompt).toBe(prompt)
      expect(result.task).toBeUndefined()
    })

    it("should handle empty prompt", () => {
      const result = parseIterationLoopTag("")

      expect(result.found).toBe(false)
      expect(result.cleanedPrompt).toBe("")
    })
  })

  describe("edge cases", () => {
    it("should handle multiline task content", () => {
      const result = parseIterationLoopTag(`
        <iterationLoop max="20">
        Build a REST API with:
        - User authentication
        - CRUD operations
        - Database integration
        </iterationLoop>
      `)

      expect(result.found).toBe(true)
      expect(result.task).toContain("Build a REST API with:")
      expect(result.task).toContain("- User authentication")
      expect(result.task).toContain("- CRUD operations")
      expect(result.task).toContain("- Database integration")
    })

    it("should handle quoted attribute values", () => {
      const result = parseIterationLoopTag(`
        <iterationLoop max="25" marker="TASK_DONE">
        Some task
        </iterationLoop>
      `)

      expect(result.maxIterations).toBe(25)
      expect(result.marker).toBe("TASK_DONE")
    })

    it("should handle unquoted max value", () => {
      const result = parseIterationLoopTag(`
        <iterationLoop max=30>
        Some task
        </iterationLoop>
      `)

      expect(result.maxIterations).toBe(30)
    })

    it("should be case-insensitive for tag name", () => {
      const result = parseIterationLoopTag(`
        <ITERATIONLOOP max="10">
        Task
        </ITERATIONLOOP>
      `)

      expect(result.found).toBe(true)
      expect(result.task).toBe("Task")
    })
  })
})

describe("buildIterationStartPrompt", () => {
  it("should build a basic iteration start prompt", () => {
    const result = buildIterationStartPrompt("Build a REST API", 20, "DONE")

    expect(result).toContain("[ITERATION LOOP STARTED - 1/20]")
    expect(result).toContain("Task: Build a REST API")
    expect(result).toContain("<completion>DONE</completion>")
    expect(result).toContain("Begin working on this task now.")
  })

  it("should include user prompt when provided", () => {
    const result = buildIterationStartPrompt(
      "Build API",
      10,
      "COMPLETE",
      "Please follow best practices"
    )

    expect(result).toContain("Task: Build API")
    expect(result).toContain("---")
    expect(result).toContain("Please follow best practices")
  })

  it("should not include separator when user prompt is empty", () => {
    const result = buildIterationStartPrompt("Build API", 10, "DONE", "")

    expect(result).not.toContain("---")
  })

  it("should not include separator when user prompt is only whitespace", () => {
    const result = buildIterationStartPrompt("Build API", 10, "DONE", "   \n   ")

    expect(result).not.toContain("---")
  })

  it("should trim user prompt", () => {
    const result = buildIterationStartPrompt("Build API", 10, "DONE", "  Some extra context  ")

    expect(result).toContain("Some extra context")
    expect(result).not.toMatch(/---\s+Some extra context  /)
  })
})
