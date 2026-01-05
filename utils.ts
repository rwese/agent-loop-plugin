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

  const isAbortMessage = (msg: string) =>
    msg.includes("abort") || msg.includes("cancel") || msg.includes("interrupt")

  if (typeof error === "string") {
    return isAbortMessage(error.toLowerCase())
  }

  if (typeof error === "object") {
    const { name, message } = error as { name?: string; message?: string }
    const lowerMessage = message?.toLowerCase() ?? ""

    // AbortError name is always an abort error
    if (name === "AbortError") return true

    // MessageAbortedError requires abort-related message content
    if (name === "MessageAbortedError" && lowerMessage && isAbortMessage(lowerMessage)) return true

    // DOMException with abort in message
    if (name === "DOMException" && lowerMessage.includes("abort")) return true

    // Check message for abort-related keywords (aborted, cancelled, interrupted)
    if (
      lowerMessage.includes("aborted") ||
      lowerMessage.includes("cancelled") ||
      lowerMessage.includes("interrupted")
    )
      return true
  }

  return false
}

/** Default paths */
const DEFAULT_STATE_FILE = ".agent-loop/iteration-state.md"
const DEFAULT_OUTPUT_FILE = ".agent-loop/output.log"

/**
 * Get a file path within the session directory
 * @param directory - The session directory
 * @param customPath - Optional custom path (relative to directory)
 * @param defaultPath - Default path to use if customPath not provided
 */
function getFilePath(
  directory: string,
  customPath: string | undefined,
  defaultPath: string
): string {
  return join(directory, customPath ?? defaultPath)
}

/**
 * Safely delete a file if it exists
 * @returns true if deletion succeeded or file didn't exist, false on error
 */
function safeUnlink(filePath: string): boolean {
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Ensure directory exists for a file path
 */
function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/**
 * Word lists for generating mission codenames (inspired by intelligence agency naming conventions)
 * Format: ADJECTIVE + NOUN (e.g., "SILENT THUNDER", "CRIMSON FALCON")
 */
const CODENAME_ADJECTIVES = [
  "SILENT",
  "CRIMSON",
  "SHADOW",
  "IRON",
  "GOLDEN",
  "ARCTIC",
  "PHANTOM",
  "STEEL",
  "MIDNIGHT",
  "COBALT",
  "VELVET",
  "THUNDER",
  "SILVER",
  "OBSIDIAN",
  "SCARLET",
  "AZURE",
  "ONYX",
  "AMBER",
  "JADE",
  "RAVEN",
  "FROST",
  "EMBER",
  "STORM",
  "LUNAR",
  "SOLAR",
  "NOBLE",
  "SWIFT",
  "BOLD",
  "DARK",
  "BRIGHT",
] as const

const CODENAME_NOUNS = [
  "THUNDER",
  "FALCON",
  "SERPENT",
  "PHOENIX",
  "DRAGON",
  "EAGLE",
  "WOLF",
  "TIGER",
  "VIPER",
  "HAWK",
  "LION",
  "PANTHER",
  "COBRA",
  "CONDOR",
  "JAGUAR",
  "SPHINX",
  "GRIFFIN",
  "HYDRA",
  "KRAKEN",
  "TITAN",
  "ORACLE",
  "SENTINEL",
  "GUARDIAN",
  "SPECTRE",
  "CIPHER",
  "VECTOR",
  "NEXUS",
  "APEX",
  "PRISM",
  "VERTEX",
] as const

/**
 * Generate a unique mission codename for iteration loop completion markers.
 *
 * Uses a combination of adjective + noun (e.g., "CRIMSON_FALCON", "SILENT_THUNDER")
 * to create memorable, unique identifiers that prevent models from pattern-matching
 * on previous completion markers.
 *
 * @returns A unique codename string (e.g., "MIDNIGHT_PHOENIX")
 *
 * @example
 * ```typescript
 * const marker = generateCodename();
 * // Returns something like "SHADOW_VIPER" or "ARCTIC_SENTINEL"
 * ```
 */
export function generateCodename(): string {
  const adjective = CODENAME_ADJECTIVES[Math.floor(Math.random() * CODENAME_ADJECTIVES.length)]
  const noun = CODENAME_NOUNS[Math.floor(Math.random() * CODENAME_NOUNS.length)]
  return `${adjective}_${noun}`
}

/**
 * Get the full path to the iteration loop state file
 *
 * @param directory - The session directory
 * @param customPath - Optional custom path (relative to directory)
 * @returns Full path to the state file
 */
export function getStateFilePath(directory: string, customPath?: string): string {
  return getFilePath(directory, customPath, DEFAULT_STATE_FILE)
}

/** Strip surrounding quotes from a string value */
const stripQuotes = (val: unknown): string => String(val ?? "").replace(/^["']|["']$/g, "")

/**
 * Read Iteration Loop state from the persisted file
 *
 * @param directory - The session directory
 * @param customPath - Optional custom path for the state file
 * @returns The loop state or null if not found/invalid
 */
export function readLoopState(directory: string, customPath?: string): IterationLoopState | null {
  const filePath = getStateFilePath(directory, customPath)

  if (!existsSync(filePath)) return null

  try {
    const content = readFileSync(filePath, "utf-8")
    const { data, body } = parseFrontmatter<Record<string, unknown>>(content)

    if (data.active === undefined || data.iteration === undefined) return null

    const iterationNum =
      typeof data.iteration === "number" ? data.iteration : parseInt(String(data.iteration), 10)
    if (isNaN(iterationNum)) return null

    return {
      active: data.active === true || data.active === "true",
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
    ensureDir(filePath)
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
  return safeUnlink(getStateFilePath(directory, customPath))
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

/** Check if a level should be logged based on minimum level */
const shouldLog = (level: LogLevel, minLevel: LogLevel): boolean =>
  LOG_LEVELS[level] <= LOG_LEVELS[minLevel]

/** Create a logger from a log handler function */
function buildLogger(
  handler: (level: LogMethod, message: string, data?: Record<string, unknown>) => void,
  logLevel: LogLevel
): Logger {
  const createMethod = (level: LogMethod) => (message: string, data?: Record<string, unknown>) => {
    if (shouldLog(level, logLevel)) handler(level, message, data)
  }
  return {
    debug: createMethod("debug"),
    info: createMethod("info"),
    warn: createMethod("warn"),
    error: createMethod("error"),
  }
}

/**
 * Create a logger with level filtering and formatting
 *
 * @param customLogger - Optional custom logger with level methods
 * @param logLevel - Minimum log level to output (default: "info")
 * @returns Configured logger with debug, info, warn, error methods
 */
export function createLogger(customLogger?: Partial<Logger>, logLevel: LogLevel = "info"): Logger {
  return buildLogger((level, message, data) => {
    const formatted = formatLogMessage(level, message, data)
    ;(customLogger?.[level] ?? console[level])(formatted, data)
  }, logLevel)
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

/**
 * Get output file path for loop logging
 *
 * @param directory - The session directory
 * @param customPath - Optional custom path (relative to directory)
 * @returns Full path to the output log file
 */
export function getOutputFilePath(directory: string, customPath?: string): string {
  return getFilePath(directory, customPath, DEFAULT_OUTPUT_FILE)
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
    ensureDir(filePath)
    const timestamp = new Date().toISOString()
    const dataStr = data ? ` ${JSON.stringify(data)}` : ""
    appendFileSync(filePath, `[${timestamp}] ${message}${dataStr}\n`, "utf-8")
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
  return safeUnlink(getOutputFilePath(directory, customPath))
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
  return buildLogger((level, message, data) => {
    writeOutput(directory, `[${level.toUpperCase()}] ${message}`, data, customPath)
  }, logLevel)
}
