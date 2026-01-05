import { createTaskContinuation } from "./task-continuation.js"
import { getEffectiveConfig, getConfigSourceInfo } from "./config.js"
function createLogger(debug) {
  return {
    debug: (message, data) => {
      if (debug) {
        console.log(`[agent-loop-plugin] DEBUG: ${message}`, data ?? "")
      }
    },
    info: (message, data) => {
      if (debug) {
        console.log(`[agent-loop-plugin] INFO: ${message}`, data ?? "")
      }
    },
    warn: (message, data) => {
      if (debug) {
        console.warn(`[agent-loop-plugin] WARN: ${message}`, data ?? "")
      }
    },
    error: (message, data) => {
      if (debug) {
        console.error(`[agent-loop-plugin] ERROR: ${message}`, data ?? "")
      }
    },
  }
}
function extractSessionID(event) {
  const props = event.properties
  if (props?.sessionID && typeof props.sessionID === "string") return props.sessionID
  if (props?.info?.sessionID && typeof props.info.sessionID === "string")
    return props.info.sessionID
  if (props?.info?.id && typeof props.info.id === "string") return props.info.id
  return undefined
}
export function createAgentLoopPlugin(options = {}) {
  const config = getEffectiveConfig(options)
  const logger = createLogger(config.debug ?? false)
  return async (ctx) => {
    const configSource = getConfigSourceInfo()
    logger.info("Initializing agent-loop-plugin", {
      directory: ctx.directory,
      configSource: configSource.source,
      configPath: configSource.path,
    })
    const sessionState = new Map()
    if (config.taskLoop) {
      logger.info("Task loop enabled", {
        countdownSeconds: config.countdownSeconds,
        errorCooldownMs: config.errorCooldownMs,
      })
    }
    return {
      event: async ({ event }) => {
        const sessionID = extractSessionID(event)
        if (!sessionID) {
          logger.debug("No session ID in event", { eventType: event.type })
          return
        }
        logger.debug("Processing event", { eventType: event.type, sessionID })
        switch (event.type) {
          case "session.idle": {
            if (config.taskLoop) {
              let state = sessionState.get(sessionID)
              if (!state) {
                state = { taskContinuation: null }
                sessionState.set(sessionID, state)
              }
              if (!state.taskContinuation) {
                const taskContinuationOptions = {
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
            if (config.taskLoop) {
              const state = sessionState.get(sessionID)
              if (state?.taskContinuation) {
              }
            }
            break
          }
          case "session.error": {
            if (config.taskLoop) {
              const state = sessionState.get(sessionID)
              if (state?.taskContinuation) {
              }
            }
            break
          }
          case "session.deleted": {
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
      config: async (_opencodeConfig) => {
        logger.debug("Configuring plugin")
      },
    }
  }
}
const plugin = createAgentLoopPlugin()
export default plugin
export { createTaskContinuation } from "./task-continuation.js"
//# sourceMappingURL=plugin.js.map
