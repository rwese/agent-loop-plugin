/**
 * Logger Module - Clean, testable logging utility
 *
 * Features:
 * - File-based logging with proper error handling
 * - Structured log format (JSON)
 * - Testable interface
 * - Automatic log directory creation
 */

import * as fs from "node:fs/promises"
import * as path from "node:path"

/**
 * Log levels supported by the logger
 */
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR"

/**
 * Log entry structure
 */
export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  data?: Record<string, unknown>
  source?: string
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Enable debug logging */
  debug?: boolean
  /** Path to log file */
  logFilePath?: string
  /** Log source identifier */
  source?: string
}

/**
 * Logger interface for dependency injection and testing
 */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
  cleanup(): Promise<void>
}

/**
 * Create a logger instance
 */
export function createLogger(config: LoggerConfig = {}): Logger {
  const { debug = false, logFilePath, source = "agent-loop-plugin" } = config

  // Store file handle for cleanup
  let fileHandle: fs.FileHandle | null = null
  let logFilePathResolved: string | null = logFilePath ?? null

  /**
   * Initialize log file
   */
  async function initializeLogFile(): Promise<void> {
    if (!logFilePathResolved) return

    try {
      const logDir = path.dirname(logFilePathResolved)
      await fs.mkdir(logDir, { recursive: true })
      fileHandle = await fs.open(logFilePathResolved, "a")
    } catch {
      // Log error to console if file logging fails
      console.error(`Failed to initialize log file: ${logFilePathResolved}`)
      logFilePathResolved = null
    }
  }

  /**
   * Write log entry to file
   */
  async function writeToFile(entry: LogEntry): Promise<void> {
    if (!fileHandle) return

    try {
      const logLine = JSON.stringify(entry) + "\n"
      await fileHandle.write(logLine)
    } catch (error) {
      // Fallback to console if file write fails
      console.error("Failed to write to log file:", error)
    }
  }

  /**
   * Create log entry
   */
  function createLogEntry(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
      source,
    }
  }

  /**
   * Log a message
   */
  async function log(level: LogLevel, message: string, data?: Record<string, unknown>): Promise<void> {
    const entry = createLogEntry(level, message, data)

    // Always log to file if configured
    if (logFilePathResolved) {
      await writeToFile(entry)
    }

    // For debug level, only log if debug is enabled
    if (level === "DEBUG" && !debug) {
      return
    }

    // Always log warnings and errors to console
    if (level === "WARN" || level === "ERROR") {
      // console.warn(`[${level}] [${source}] ${message}`, data ?? "")
    }

    // Log info and debug to console if debug is enabled
    if ((level === "INFO" || level === "DEBUG") && debug) {
      // console.log removed - debug output disabled
    }
  }

  // Initialize log file asynchronously
  initializeLogFile()

  return {
    debug: (message: string, data?: Record<string, unknown>) => {
      log("DEBUG", message, data).catch(() => {})
    },

    info: (message: string, data?: Record<string, unknown>) => {
      log("INFO", message, data).catch(() => {})
    },

    warn: (message: string, data?: Record<string, unknown>) => {
      log("WARN", message, data).catch(() => {})
    },

    error: (message: string, data?: Record<string, unknown>) => {
      log("ERROR", message, data).catch(() => {})
    },

    cleanup: async () => {
      if (fileHandle) {
        try {
          await fileHandle.close()
        } catch {
          // Ignore cleanup errors
        }
        fileHandle = null
      }
    },
  }
}

/**
 * Create a no-op logger for testing or when logging is disabled
 */
export function createNoopLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    cleanup: async () => {},
  }
}

/**
 * Create a console-only logger for development
 */
export function createConsoleLogger(source: string = "agent-loop-plugin", debug: boolean = false): Logger {
  return {
    debug: (_message: string, _data?: Record<string, unknown>) => {
      if (debug) {
        // console.log removed - debug output disabled
      }
    },

    info: (_message: string, _data?: Record<string, unknown>) => {
      // console.log removed - info output disabled
    },

    warn: (message: string, data?: Record<string, unknown>) => {
      console.warn(`[WARN] [${source}] ${message}`, data ?? "")
    },

    error: (message: string, data?: Record<string, unknown>) => {
      console.error(`[ERROR] [${source}] ${message}`, data ?? "")
    },

    cleanup: async () => {},
  }
}
