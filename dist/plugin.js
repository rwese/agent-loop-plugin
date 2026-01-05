import * as fs from "node:fs"
import * as path from "node:path"
import { createTaskContinuation } from "./task-continuation.js"
import { getEffectiveConfig, getConfigSourceInfo } from "./config.js"
function createLogger(debug, logFilePath) {
  let logFile = null
  if (logFilePath) {
    try {
      const logDir = path.dirname(logFilePath)
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
      }
      logFile = fs.createWriteStream(logFilePath, { flags: "a" })
    } catch (error) {
      console.warn(`[agent-loop-plugin] Failed to create log file: ${error}`)
    }
  }
  function writeToLog(level, message, data) {
    const timestamp = new Date().toISOString()
    const dataStr = data ? ` ${JSON.stringify(data)}` : ""
    const logLine = `[${timestamp}] [${level}] [agent-loop-plugin] ${message}${dataStr}\n`
    if (debug) {
      if (level === "ERROR") {
        console.error(logLine.trim())
      } else if (level === "WARN") {
        console.warn(logLine.trim())
      } else {
        console.log(logLine.trim())
      }
    }
    if (logFile) {
      try {
        logFile.write(logLine)
      } catch (error) {
        console.warn(`[agent-loop-plugin] Failed to write to log file: ${error}`)
      }
    }
  }
  return {
    debug: (message, data) => {
      writeToLog("DEBUG", message, data)
    },
    info: (message, data) => {
      writeToLog("INFO", message, data)
    },
    warn: (message, data) => {
      writeToLog("WARN", message, data)
    },
    error: (message, data) => {
      writeToLog("ERROR", message, data)
    },
    cleanup: () => {
      if (logFile) {
        try {
          logFile.end()
        } catch {}
        logFile = null
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
  const logger = createLogger(config.debug ?? false, config.logFilePath)
  return async (ctx) => {
    const configSource = getConfigSourceInfo()
    logger.info("Initializing agent-loop-plugin", {
      directory: ctx.directory,
      configSource: configSource.source,
      configPath: configSource.path,
      logFilePath: config.logFilePath,
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
                  logFilePath: config.logFilePath,
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
      cleanup: async () => {
        logger.info("Cleaning up agent-loop-plugin")
        for (const state of sessionState.values()) {
          if (state.taskContinuation) {
            await state.taskContinuation.cleanup()
          }
        }
        sessionState.clear()
        logger.cleanup()
      },
    }
  }
}
const plugin = createAgentLoopPlugin()
export default plugin
export { createTaskContinuation } from "./task-continuation.js"
//# sourceMappingURL=plugin.js.map
