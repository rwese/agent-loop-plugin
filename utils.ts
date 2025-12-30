/**
 * Utility functions for agent loops
 *
 * This module provides shared utilities used by both Task Loop and Iteration Loop:
 *
 * - **State Management**: Read/write loop state to files (YAML frontmatter format)
 * - **Logging**: Configurable loggers with level filtering and file output
 * - **Messaging**: Send "ignored" messages to session UI
 * - **Error Detection**: Identify abort/cancellation errors
 * - **Frontmatter Parsing**: Simple YAML frontmatter parser
 *
 * ## State File Format
 *
 * Loop state is persisted as Markdown with YAML frontmatter:
 * ```
 * ---
 * active: true
 * iteration: 3
 * max_iterations: 20
 * ---
 * Original prompt content here...
 * ```
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

/**
 * Result of parsing frontmatter from a file.
 * Contains extracted YAML data and the remaining body content.
 */
export interface FrontmatterResult<T = Record<string, unknown>> {
  /** Parsed YAML data from frontmatter */
  data: T
  /** Content after the frontmatter section */
  body: string
}

/**
 * Parse YAML frontmatter from a string.
 *
 * Frontmatter format:
 * ```
 * ---
 * key: value
 * number: 42
 * boolean: true
 * ---
 * Body content here...
 * ```
 *
 * Supports: strings, numbers, booleans. Strips quotes from string values.
 * Note: This is a simple parser, not a full YAML implementation.
 *
 * @param content - The full file content with potential frontmatter
 * @returns Parsed data and body, or empty data if no frontmatter found
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
 *
 * Detects various abort error patterns:
 * - MessageAbortedError, AbortError names
 * - DOMException with "abort" message
 * - Error messages containing "aborted", "cancelled", "interrupted"
 *
 * Used to distinguish user cancellations from real errors.
 * Abort errors typically shouldn't trigger error cooldowns.
 *
 * @param error - The error to check (can be any type)
 * @returns true if this appears to be an abort/cancellation
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

/**
 * Get the full path to the iteration loop state file.
 *
 * Default location: `.agent-loop/iteration-state.md`
 * Can be customized via options.
 *
 * @param directory - Base directory (usually ctx.directory)
 * @param customPath - Optional custom path relative to directory
 */
export function getStateFilePath(directory: string, customPath?: string): string {
  const defaultPath = ".agent-loop/iteration-state.md"
  return customPath ? join(directory, customPath) : join(directory, defaultPath)
}

/**
 * Read Iteration Loop state from the persisted file.
 *
 * Parses the YAML frontmatter to extract:
 * - active: boolean
 * - iteration: number
 * - max_iterations: number
 * - completion_marker: string
 * - started_at: ISO date string
 * - session_id: optional session binding
 *
 * The body of the file contains the original prompt.
 *
 * @param directory - Base directory
 * @param customPath - Optional custom state file path
 * @returns Parsed state or null if file doesn't exist or is invalid
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
 * Write Iteration Loop state to file.
 *
 * Creates the directory structure if needed.
 * State is written as Markdown with YAML frontmatter.
 *
 * @param directory - Base directory
 * @param state - The loop state to persist
 * @param customPath - Optional custom state file path
 * @returns true on success, false on error
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
 * Delete the Iteration Loop state file.
 * Called when loop completes or is cancelled.
 *
 * @param directory - Base directory
 * @param customPath - Optional custom state file path
 * @returns true on success, false on error
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
 * Increment the iteration counter in the state file.
 * Reads current state, increments iteration, writes back.
 *
 * @param directory - Base directory
 * @param customPath - Optional custom state file path
 * @returns Updated state or null on error
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

/**
 * Log level priority mapping.
 * Higher number = more verbose. Used for level filtering.
 *
 * silent (0) - No output
 * error (1)  - Only errors
 * warn (2)   - Errors + warnings
 * info (3)   - Normal operation logs
 * debug (4)  - Verbose debugging
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
}

/**
 * Create a logger with level filtering and formatting
 *
 * @param customLogger - Optional custom logger implementation (defaults to console)
 * @param logLevel - Log level for filtering (defaults to 'info')
 * @returns Logger instance with level filtering
 *
 * @example
 * ```typescript
 * const logger = createLogger(console, 'debug');
 * logger.debug('Starting process...', { count: 5 });
 * logger.info('Process complete');
 * ```
 */
export function createLogger(customLogger?: Partial<Logger>, logLevel: LogLevel = "info"): Logger {
  const currentLevel = LOG_LEVELS[logLevel]

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= currentLevel
  }

  function formatMessage(level: string, message: string, data?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString()
    const dataStr = data ? ` ${JSON.stringify(data)}` : ""
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`
  }

  return {
    debug(message: string, data?: Record<string, unknown>): void {
      if (shouldLog("debug")) {
        const formatted = formatMessage("debug", message, data)
        if (customLogger?.debug) {
          customLogger.debug(formatted, data)
        } else {
          console.debug(formatted)
        }
      }
    },

    info(message: string, data?: Record<string, unknown>): void {
      if (shouldLog("info")) {
        const formatted = formatMessage("info", message, data)
        if (customLogger?.info) {
          customLogger.info(formatted, data)
        } else {
          console.info(formatted)
        }
      }
    },

    warn(message: string, data?: Record<string, unknown>): void {
      if (shouldLog("warn")) {
        const formatted = formatMessage("warn", message, data)
        if (customLogger?.warn) {
          customLogger.warn(formatted, data)
        } else {
          console.warn(formatted)
        }
      }
    },

    error(message: string, data?: Record<string, unknown>): void {
      if (shouldLog("error")) {
        const formatted = formatMessage("error", message, data)
        if (customLogger?.error) {
          customLogger.error(formatted, data)
        } else {
          console.error(formatted)
        }
      }
    },
  }
}

/**
 * Simple logging utility (deprecated - use createLogger instead)
 * @deprecated Use createLogger instead
 */
export function log(_message: string, _data?: Record<string, unknown>): void {
  // No-op: console.log removed
}

/**
 * Options for sending ignored messages
 */
export interface SendIgnoredMessageOptions {
  /** Agent to use for the message */
  agent?: string
  /** Model to use for the message */
  model?: string
}

/**
 * Send an ignored message to the session UI.
 * The message is displayed but NOT added to the model's context.
 *
 * @param client - The OpenCode client instance
 * @param sessionID - The session ID to send to
 * @param text - The message text to display
 * @param logger - Optional logger for error reporting
 * @param options - Optional agent and model configuration
 *
 * @example
 * ```typescript
 * await sendIgnoredMessage(ctx.client, sessionID, "Task loop: 3 tasks remaining");
 *
 * // With agent and model
 * await sendIgnoredMessage(ctx.client, sessionID, "Status update", logger, {
 *   agent: "orchestrator",
 *   model: "claude-3-5-sonnet"
 * });
 * ```
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

/**
 * Get output file path for loop logging
 */
export function getOutputFilePath(directory: string, customPath?: string): string {
  const defaultPath = ".agent-loop/output.log"
  return customPath ? join(directory, customPath) : join(directory, defaultPath)
}

/**
 * Write output to a file, appending to existing content.
 * Creates the directory structure if it doesn't exist.
 *
 * @param directory - Base directory for the output file
 * @param message - The message to write
 * @param data - Optional structured data to include
 * @param customPath - Optional custom file path (relative to directory)
 *
 * @example
 * ```typescript
 * writeOutput("/project", "Task started", { taskId: "123" });
 * writeOutput("/project", "Custom log", undefined, "logs/custom.log");
 * ```
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
 * @param directory - Base directory for the output file
 * @param customPath - Optional custom file path (relative to directory)
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
 * @param directory - Base directory for the output file
 * @param customPath - Optional custom file path (relative to directory)
 * @param logLevel - Log level for filtering (defaults to 'info')
 *
 * @example
 * ```typescript
 * const fileLogger = createFileLogger("/project", "logs/agent.log", "debug");
 * fileLogger.info("Task started", { taskId: "123" });
 * ```
 */
export function createFileLogger(
  directory: string,
  customPath?: string,
  logLevel: LogLevel = "info"
): Logger {
  const currentLevel = LOG_LEVELS[logLevel]

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] <= currentLevel
  }

  function logToFile(level: string, message: string, data?: Record<string, unknown>): void {
    const formattedMessage = `[${level.toUpperCase()}] ${message}`
    writeOutput(directory, formattedMessage, data, customPath)
  }

  return {
    debug(message: string, data?: Record<string, unknown>): void {
      if (shouldLog("debug")) {
        logToFile("debug", message, data)
      }
    },

    info(message: string, data?: Record<string, unknown>): void {
      if (shouldLog("info")) {
        logToFile("info", message, data)
      }
    },

    warn(message: string, data?: Record<string, unknown>): void {
      if (shouldLog("warn")) {
        logToFile("warn", message, data)
      }
    },

    error(message: string, data?: Record<string, unknown>): void {
      if (shouldLog("error")) {
        logToFile("error", message, data)
      }
    },
  }
}
