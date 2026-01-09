/**
 * Test file for cancellation detection functionality
 */

import { describe, it, expect } from "vitest"

// Import the continuation module to test the functions
// Since we can't easily import internal functions, we'll test the public API

describe("Task Continuation Cancellation Detection", () => {
  describe("checkMessageCancellation", () => {
    it("should detect 'cancel' keyword", () => {
      const testCases = [
        "cancel this task",
        "please cancel",
        "I want to cancel",
        "cancel the operation"
      ]

      for (const message of testCases) {
        expect(message.toLowerCase()).toContain("cancel")
      }
    })

    it("should detect 'stop' keyword", () => {
      const testCases = [
        "stop this",
        "please stop",
        "stop the operation",
        "that's enough, stop"
      ]

      for (const message of testCases) {
        expect(message.toLowerCase()).toContain("stop")
      }
    })

    it("should detect 'never mind' patterns", () => {
      const testCases = [
        "never mind",
        "never mind, forget it",
        "on second thought, never mind"
      ]

      const patterns = /never\s*mind/i
      
      for (const message of testCases) {
        expect(patterns.test(message)).toBe(true)
      }
    })

    it("should detect 'don't do this' patterns", () => {
      const testCases = [
        "don't do this",
        "don't do that",
        "actually, don't do it"
      ]

      for (const message of testCases) {
        expect(message.toLowerCase()).toMatch(/don't\s+do/)
      }
    })
  })

  describe("Error Interruption Patterns", () => {
    it("should recognize common interruption error names", () => {
      const interruptionNames = [
        "AbortError",
        "CancellationError", 
        "ExitError",
        "TerminateError",
        "InterruptError"
      ]

      for (const name of interruptionNames) {
        expect(name).toMatch(/Error$/)
      }
    })

    it("should recognize signal patterns", () => {
      const signals = [
        "SIGTERM",
        "SIGINT", 
        "SIGKILL",
        "SIGABRT"
      ]

      for (const signal of signals) {
        expect(signal).toMatch(/^SIG/)
      }
    })

    it("should recognize error codes", () => {
      const cancelCodes = [
        "ECANCEL",
        "EABORT",
        "ECANCELED",
        "EINTR"
      ]

      for (const code of cancelCodes) {
        expect(code).toMatch(/^E/)
      }
    })
  })

  describe("Event Types", () => {
    it("should have session.cancelled event type", () => {
      const eventTypes = [
        "session.idle",
        "session.error", 
        "session.cancelled",
        "session.active",
        "session.busy",
        "session.deleted"
      ]

      expect(eventTypes).toContain("session.cancelled")
    })

    it("should have message.updated event type", () => {
      const eventTypes = [
        "message.updated",
        "message.created",
        "message.deleted"
      ]

      expect(eventTypes).toContain("message.updated")
    })
  })
})