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
}

/**
 * Logging utility
 */
function createLogger(debug: boolean) {
  return {
    debug: (message: string, data?: Record<string, unknown>) => {
      if (debug) {
        console.log(`[agent-loop-plugin] DEBUG: ${message}`, data ?? "")
      }
    },
    info: (message: string, data?: Record<string, unknown>) => {
      if (debug) {
        console.log(`[agent-loop-plugin] INFO: ${message}`, data ?? "")
      }
    },
    warn: (message: string, data?: Record<string, unknown>) => {
      if (debug) {
        console.warn(`[agent-loop-plugin] WARN: ${message}`, data ?? "")
      }
    },
    error: (message: string, data?: Record<string, unknown>) => {
      if (debug) {
        console.error(`[agent-loop-plugin] ERROR: ${message}`, data ?? "")
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
  const logger = createLogger(config.debug ?? false)

  return async (ctx: PluginContext) => {
    const configSource = getConfigSourceInfo()
    logger.info("Initializing agent-loop-plugin", {
      directory: ctx.directory,
      configSource: configSource.source,
      configPath: configSource.path,
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
                // Task loop will handle message.updated events automatically
              }
            }
            break
          }

          case "session.error": {
            // Errors trigger cooldown in task loop
            if (config.taskLoop) {
              const state = sessionState.get(sessionID)
              if (state?.taskContinuation) {
                // Task loop handles session.error events automatically
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
