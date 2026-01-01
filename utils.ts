/**
 * Shared utilities for agent loops: state management, logging, messaging, error detection
 *
 * ## Categories
 *
 * - **State Management**: Reading/writing loop state files with YAML frontmatter
 * - **Logging**: Logger creation and file-based logging
 * - **Messaging**: Sending ignored messages to sessions
 * - **Error Detection**: Abort/cancellation error identification
 *
 * @module utils
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  appendFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import type { IterationLoopState, Logger, LogLevel } from "./types.js"

/** Result of parsing frontmatter from a file */
export interface FrontmatterResult<T = Record<string, unknown>> {
  /** Parsed frontmatter data as an object */
  data: T
  /** Content after the frontmatter delimiter */
  body: string
}

/**
 * Parse YAML frontmatter from a string. Supports strings, numbers, booleans.
 *
 * @example
 * ```typescript
 * const content = `---\ntitle: "Test"\ncount: 42\nactive: true\n---\nBody content`;
 * const { data, body } = parseFrontmatter(content);
 * // data: { title: "Test", count: 42, active: true }
 * // body: "Body content"
 * ```
 *
 * @param content - The string containing YAML frontmatter
 * @returns Parsed frontmatter data and body content
 */
export function parseFrontmatter<T = Record<string, unknown>>(
  content: string
): FrontmatterResult<T> {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
  const match = content.match(frontmatterRegex)

  if (!match) {
    return { data: {} as T, body: content }
  }

  const yamlContent = match[1]
  const body = match[2]

  const data: Record<string, string | boolean | number> = {}
  for (const line of yamlContent.split("\n")) {
    const colonIndex = line.indexOf(":")
    if (colonIndex !== -1) {
      const key = line.slice(0, colonIndex).trim()
      let value: string | boolean | number = line.slice(colonIndex + 1).trim()

      // Strip quotes from string values
      if (typeof value === "string" && /^["'].*["']$/.test(value)) {
        value = value.slice(1, -1)
      }

      if (value === "true") value = true
      else if (value === "false") value = false
      else if (!isNaN(Number(value)) && value !== "") value = Number(value)

      data[key] = value
    }
  }

  return { data: data as T, body }
}

/**
 * Check if an error is an abort/cancellation error.
 * Handles various error formats and message patterns.
 *
 * @param error - The error to check
 * @returns true if the error appears to be an abort/cancellation error
 */
export function isAbortError(error: unknown): boolean {
  if (!error) return false

  if (typeof error === "object") {
    const errObj = error as Record<string, unknown>
    const name = errObj.name as string | undefined
    const message = (errObj.message as string | undefined)?.toLowerCase() ?? ""

    if (name === "MessageAbortedError" || name === "AbortError") {
      // Only return true if message is not empty or has abort-related content
      if (
        message &&
        (message.includes("abort") || message.includes("cancel") || message.includes("interrupt"))
      ) {
        return true
      }
      // For AbortError with empty message, still consider it an abort error
      if (name === "AbortError") return true
      return false
    }
    if (name === "DOMException" && message.includes("abort")) return true
    if (
      message.includes("aborted") ||
      message.includes("cancelled") ||
      message.includes("interrupted")
    )
      return true
  }

  if (typeof error === "string") {
    const lower = error.toLowerCase()
    return lower.includes("abort") || lower.includes("cancel") || lower.includes("interrupt")
  }

  return false
}

/** Default path for iteration loop state file */
const DEFAULT_STATE_FILE = ".agent-loop/iteration-state.md"

/**
 * Get the full path to the iteration loop state file
 *
 * @param directory - The session directory
 * @param customPath - Optional custom path (relative to directory)
 * @returns Full path to the state file
 */
export function getStateFilePath(directory: string, customPath?: string): string {
  const defaultPath = DEFAULT_STATE_FILE
  return customPath ? join(directory, customPath) : join(directory, defaultPath)
}

/**
 * Read Iteration Loop state from the persisted file
 *
 * @param directory - The session directory
 * @param customPath - Optional custom path for the state file
 * @returns The loop state or null if not found/invalid
 */
export function readLoopState(directory: string, customPath?: string): IterationLoopState | null {
  const filePath = getStateFilePath(directory, customPath)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    const { data, body } = parseFrontmatter<Record<string, unknown>>(content)

    const active = data.active
    const iteration = data.iteration

    if (active === undefined || iteration === undefined) {
      return null
    }

    const isActive = active === true || active === "true"
    const iterationNum = typeof iteration === "number" ? iteration : parseInt(String(iteration), 10)

    if (isNaN(iterationNum)) {
      return null
    }

    const stripQuotes = (val: unknown): string => {
      const str = String(val ?? "")
      return str.replace(/^["']|["']$/g, "")
    }

    return {
      active: isActive,
      iteration: iterationNum,
      max_iterations: Number(data.max_iterations) || 100,
      completion_marker: stripQuotes(data.completion_marker) || "DONE",
      started_at: stripQuotes(data.started_at) || new Date().toISOString(),
      prompt: body.trim(),
      session_id: data.session_id ? stripQuotes(data.session_id) : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Write Iteration Loop state to file
 *
 * @param directory - The session directory
 * @param state - The state object to write
 * @param customPath - Optional custom path for the state file
 * @returns true if write succeeded, false otherwise
 */
export function writeLoopState(
  directory: string,
  state: IterationLoopState,
  customPath?: string
): boolean {
  const filePath = getStateFilePath(directory, customPath)

  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const sessionIdLine = state.session_id ? `session_id: "${state.session_id}"\n` : ""
    const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.max_iterations}
completion_marker: "${state.completion_marker}"
started_at: "${state.started_at}"
${sessionIdLine}---
${state.prompt}
`

    writeFileSync(filePath, content, "utf-8")
    return true
  } catch {
    return false
  }
}

/**
 * Delete the Iteration Loop state file
 *
 * @param directory - The session directory
 * @param customPath - Optional custom path for the state file
 * @returns true if deletion succeeded or file didn't exist, false on error
 */
export function clearLoopState(directory: string, customPath?: string): boolean {
  const filePath = getStateFilePath(directory, customPath)

  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Increment the iteration counter in the state file
 *
 * @param directory - The session directory
 * @param customPath - Optional custom path for the state file
 * @returns Updated state or null if read/write failed
 */
export function incrementIteration(
  directory: string,
  customPath?: string
): IterationLoopState | null {
  const state = readLoopState(directory, customPath)
  if (!state) return null

  state.iteration += 1
  if (writeLoopState(directory, state, customPath)) {
    return state
  }
  return null
}

/** Log level priority mapping - lower values = more restrictive */
const LOG_LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
}

type LogMethod = "debug" | "info" | "warn" | "error"

/** Format a log message with timestamp, level, and optional data */
function formatLogMessage(level: string, message: string, data?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString()
  const dataStr = data ? ` ${JSON.stringify(data)}` : ""
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`
}

/**
 * Create a logger with level filtering and formatting
 *
 * @param customLogger - Optional custom logger with level methods
 * @param logLevel - Minimum log level to output (default: "info")
 * @returns Configured logger with debug, info, warn, error methods
 */
export function createLogger(customLogger?: Partial<Logger>, logLevel: LogLevel = "info"): Logger {
  const currentLevel = LOG_LEVELS[logLevel]
  const shouldLog = (level: LogLevel) => LOG_LEVELS[level] <= currentLevel

  const logMethod =
    (level: LogMethod) =>
    (message: string, data?: Record<string, unknown>): void => {
      if (!shouldLog(level)) return
      const formatted = formatLogMessage(level, message, data)
      const method = customLogger?.[level] ?? console[level]
      method(formatted, data)
    }

  return {
    debug: logMethod("debug"),
    info: logMethod("info"),
    warn: logMethod("warn"),
    error: logMethod("error"),
  }
}

/** Options for sending ignored messages */
export interface SendIgnoredMessageOptions {
  /** Agent name to use when prompting */
  agent?: string
  /** Model name to use when prompting */
  model?: string
}

/**
 * Send an ignored message to the session UI (displayed but not added to model context)
 *
 * Ignored messages appear in the session UI for user visibility but don't affect
 * the AI's context window or response generation.
 *
 * @param client - OpenCode client with session.prompt method
 * @param sessionID - Target session ID
 * @param text - Message text to send
 * @param logger - Optional logger for error reporting
 * @param options - Optional agent/model configuration
 */
export async function sendIgnoredMessage(
  client: {
    session: {
      prompt(opts: {
        path: { id: string }
        body: {
          agent?: string
          model?: string
          noReply?: boolean
          parts: Array<{ type: string; text: string; ignored?: boolean }>
        }
      }): Promise<void>
    }
  },
  sessionID: string,
  text: string,
  logger?: Logger,
  options?: SendIgnoredMessageOptions
): Promise<void> {
  try {
    await client.session.prompt({
      path: { id: sessionID },
      body: {
        agent: options?.agent,
        model: options?.model,
        noReply: true,
        parts: [
          {
            type: "text",
            text: text,
            ignored: true,
          },
        ],
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (logger) {
      logger.error("Failed to send ignored message", {
        error: message,
        sessionID,
      })
    }
  }
}

/** Default path for output log file */
const DEFAULT_OUTPUT_FILE = ".agent-loop/output.log"

/**
 * Get output file path for loop logging
 *
 * @param directory - The session directory
 * @param customPath - Optional custom path (relative to directory)
 * @returns Full path to the output log file
 */
export function getOutputFilePath(directory: string, customPath?: string): string {
  const defaultPath = DEFAULT_OUTPUT_FILE
  return customPath ? join(directory, customPath) : join(directory, defaultPath)
}

/**
 * Write output to a file, appending to existing content
 *
 * @param directory - The session directory
 * @param message - Message to write
 * @param data - Optional data object to serialize and append
 * @param customPath - Optional custom path for the output file
 * @returns true if write succeeded, false otherwise
 */
export function writeOutput(
  directory: string,
  message: string,
  data?: Record<string, unknown>,
  customPath?: string
): boolean {
  const filePath = getOutputFilePath(directory, customPath)

  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const timestamp = new Date().toISOString()
    const dataStr = data ? ` ${JSON.stringify(data)}` : ""
    const line = `[${timestamp}] ${message}${dataStr}\n`

    appendFileSync(filePath, line, "utf-8")
    return true
  } catch {
    return false
  }
}

/**
 * Clear the output file
 *
 * @param directory - The session directory
 * @param customPath - Optional custom path for the output file
 * @returns true if deletion succeeded or file didn't exist, false on error
 */
export function clearOutput(directory: string, customPath?: string): boolean {
  const filePath = getOutputFilePath(directory, customPath)

  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Create a file-based logger that writes to a file
 *
 * @param directory - The session directory for output file location
 * @param customPath - Optional custom path for the log file
 * @param logLevel - Minimum log level to output (default: "info")
 * @returns Logger that writes formatted messages to the file
 */
export function createFileLogger(
  directory: string,
  customPath?: string,
  logLevel: LogLevel = "info"
): Logger {
  const currentLevel = LOG_LEVELS[logLevel]
  const shouldLog = (level: LogLevel) => LOG_LEVELS[level] <= currentLevel

  const logMethod =
    (level: LogMethod) =>
    (message: string, data?: Record<string, unknown>): void => {
      if (!shouldLog(level)) return
      writeOutput(directory, `[${level.toUpperCase()}] ${message}`, data, customPath)
    }

  return {
    debug: logMethod("debug"),
    info: logMethod("info"),
    warn: logMethod("warn"),
    error: logMethod("error"),
  }
}
