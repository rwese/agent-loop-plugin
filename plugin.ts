/**
 * OpenCode Plugin - Agent Loop Integration
 *
 * This plugin provides agent loop mechanisms for OpenCode:
 * - Task Loop: Automatically continues sessions when incomplete tasks remain
 * - Iteration Loop: Continues iteration until completion signal is received
 *
 * ## Features
 *
 * - Monitors session.idle events to detect when work can continue
 * - Fetches todo list via OpenCode API
 * - Injects continuation prompt if incomplete tasks exist
 * - Countdown with toast notification before continuation
 * - User messages cancel pending continuations
 * - Error handling with cooldown periods
 *
 * ## Usage
 *
 * ```typescript
 * import agentLoopPlugin from './plugin';
 *
 * // In your OpenCode configuration
 * export default agentLoopPlugin;
 * ```
 */

import * as fs from "node:fs"
import * as path from "node:path"
import type { LoopEvent, PluginContext, TaskContinuationOptions } from "./types.js"
import { createTaskContinuation } from "./task-continuation.js"
import { getEffectiveConfig, getConfigSourceInfo } from "./config.js"

/**
 * Plugin configuration options
 */
export interface AgentLoopPluginOptions {
  /** Enable task loop functionality (default: true) */
  taskLoop?: boolean
  /** Enable iteration loop functionality (default: true) */
  iterationLoop?: boolean
  /** Default countdown seconds before auto-continuation (default: 2) */
  countdownSeconds?: number
  /** Cooldown period in ms after errors (default: 3000) */
  errorCooldownMs?: number
  /** Toast notification duration in ms (default: 900) */
  toastDurationMs?: number
  /** Agent name for continuation prompts */
  agent?: string
  /** Model name for continuation prompts */
  model?: string
  /** Enable debug logging */
  debug?: boolean
  /** Path to log file for writing logs */
  logFilePath?: string
}

/**
 * Logging utility
 */
function createLogger(debug: boolean, logFilePath?: string) {
  let logFile: fs.WriteStream | null = null

  // Initialize log file if path is provided
  if (logFilePath) {
    try {
      // Ensure the directory exists
      const logDir = path.dirname(logFilePath)
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
      }

      // Open the log file in append mode
      logFile = fs.createWriteStream(logFilePath, { flags: "a" })
    } catch {
      // Ignore logging setup errors
    }
  }

  function writeToLog(level: string, message: string, data?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString()
    const dataStr = data ? ` ${JSON.stringify(data)}` : ""
    const logLine = `[${timestamp}] [${level}] [agent-loop-plugin] ${message}${dataStr}\n`

    // Write to log file only - no console output
    if (logFile) {
      try {
        logFile.write(logLine)
      } catch {
        // Ignore file write errors
      }
    }
  }

  return {
    debug: (message: string, data?: Record<string, unknown>) => {
      writeToLog("DEBUG", message, data)
    },
    info: (message: string, data?: Record<string, unknown>) => {
      writeToLog("INFO", message, data)
    },
    warn: (message: string, data?: Record<string, unknown>) => {
      writeToLog("WARN", message, data)
    },
    error: (message: string, data?: Record<string, unknown>) => {
      writeToLog("ERROR", message, data)
    },
    cleanup: () => {
      if (logFile) {
        try {
          logFile.end()
        } catch {
          // Ignore cleanup errors
        }
        logFile = null
      }
    },
  }
}

/**
 * Extract session ID from event properties
 */
function extractSessionID(event: LoopEvent): string | undefined {
  const props = event.properties
  if (props?.sessionID && typeof props.sessionID === "string") return props.sessionID
  if (props?.info?.sessionID && typeof props.info.sessionID === "string")
    return props.info.sessionID
  if (props?.info?.id && typeof props.info.id === "string") return props.info.id
  return undefined
}

/**
 * Create the agent loop plugin
 */
export function createAgentLoopPlugin(options: AgentLoopPluginOptions = {}) {
  const config = getEffectiveConfig(options)
  const logger = createLogger(config.debug ?? false, config.logFilePath)

  return async (ctx: PluginContext) => {
    const configSource = getConfigSourceInfo()
    logger.info("Initializing agent-loop-plugin", {
      directory: ctx.directory,
      configSource: configSource.source,
      configPath: configSource.path,
      logFilePath: config.logFilePath,
    })

    // Track session state
    const sessionState = new Map<
      string,
      {
        taskContinuation: ReturnType<typeof createTaskContinuation> | null
      }
    >()

    // Create task continuation if enabled
    if (config.taskLoop) {
      logger.info("Task loop enabled", {
        countdownSeconds: config.countdownSeconds,
        errorCooldownMs: config.errorCooldownMs,
      })
    }

    return {
      /**
       * Event handler for session events
       */
      event: async ({ event }: { event: LoopEvent }) => {
        const sessionID = extractSessionID(event)
        if (!sessionID) {
          logger.debug("No session ID in event", { eventType: event.type })
          return
        }

        logger.debug("Processing event", { eventType: event.type, sessionID })

        // Handle session events
        switch (event.type) {
          case "session.idle": {
            // Task loop handles idle events
            if (config.taskLoop) {
              let state = sessionState.get(sessionID)
              if (!state) {
                state = { taskContinuation: null }
                sessionState.set(sessionID, state)
              }

              if (!state.taskContinuation) {
                const taskContinuationOptions: TaskContinuationOptions = {
                  countdownSeconds: config.countdownSeconds,
                  errorCooldownMs: config.errorCooldownMs,
                  toastDurationMs: config.toastDurationMs,
                  agent: config.agent,
                  model: config.model,
                  logFilePath: config.logFilePath,
                  continuationPromptFile: config.continuationPromptFile,
                }
                state.taskContinuation = createTaskContinuation(ctx, taskContinuationOptions)
              }

              await state.taskContinuation.handler({ event })
            }
            break
          }

          case "message.updated": {
            // User messages cancel pending continuations in task loop
            if (config.taskLoop) {
              const state = sessionState.get(sessionID)
              if (state?.taskContinuation) {
                // Task loop handles message.updated events to capture agent/model
                await state.taskContinuation.handler({ event })
              }
            }
            break
          }

          case "session.error": {
            // Errors trigger cooldown in task loop
            if (config.taskLoop) {
              const state = sessionState.get(sessionID)
              if (state?.taskContinuation) {
                // Task loop handles session.error events to set cooldown
                await state.taskContinuation.handler({ event })
              }
            }
            break
          }

          case "session.active":
          case "session.busy": {
            // Agent is processing - cancel any pending continuation
            if (config.taskLoop) {
              const state = sessionState.get(sessionID)
              if (state?.taskContinuation) {
                await state.taskContinuation.handler({ event })
              }
            }
            break
          }

          case "session.deleted": {
            // Cleanup session state
            const state = sessionState.get(sessionID)
            if (state?.taskContinuation) {
              await state.taskContinuation.cleanup()
            }
            sessionState.delete(sessionID)
            logger.debug("Cleaned up session state", { sessionID })
            break
          }

          default:
            logger.debug("Unhandled event type", { eventType: event.type })
        }
      },

      /**
       * Plugin configuration handler
       */
      config: async (_opencodeConfig: Record<string, unknown>) => {
        logger.debug("Configuring plugin")

        // Add any custom configuration here
        // For example, adding custom tools or modifying existing ones
      },

      /**
       * Plugin cleanup handler
       */
      cleanup: async () => {
        logger.info("Cleaning up agent-loop-plugin")

        // Cleanup all session states
        for (const state of sessionState.values()) {
          if (state.taskContinuation) {
            await state.taskContinuation.cleanup()
          }
        }
        sessionState.clear()

        // Cleanup logger
        logger.cleanup()
      },
    }
  }
}

/**
 * Default plugin instance
 */
const plugin = createAgentLoopPlugin()

export default plugin

// Re-export types and functions for library usage
export type {
  Todo,
  LoopEvent,
  TaskContinuationOptions,
  PluginContext,
  ModelSpec,
  PromptPart,
  SessionInfo,
  MessageInfo,
  LogLevel,
  CountdownCallbackInfo,
  TaskLoopOptions,
} from "./types.js"

export { createTaskContinuation } from "./task-continuation.js"
