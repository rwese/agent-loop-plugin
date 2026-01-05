import * as fs from "node:fs"
import * as path from "node:path"
import { loadPromptTemplate } from "./prompts.js"
function createFileLogger(logFilePath) {
  let logFile = null
  let logBuffer = []
  if (logFilePath) {
    try {
      const logDir = path.dirname(logFilePath)
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
      }
      logFile = setInterval(() => {
        if (logBuffer.length > 0) {
          try {
            fs.appendFileSync(logFilePath, logBuffer.join(""))
            logBuffer = []
          } catch {}
        }
      }, 1000)
    } catch {}
  }
  function log(level, message, data) {
    const timestamp = new Date().toISOString()
    const dataStr = data ? ` ${JSON.stringify(data)}` : ""
    const logLine = `[${timestamp}] [${level}] [task-continuation] ${message}${dataStr}\n`
    if (logFile) {
      logBuffer.push(logLine)
    }
  }
  return {
    debug: (message, data) => log("DEBUG", message, data),
    info: (message, data) => log("INFO", message, data),
    warn: (message, data) => log("WARN", message, data),
    error: (message, data) => log("ERROR", message, data),
    flush: () => {
      if (logFile && logBuffer.length > 0) {
        try {
          fs.appendFileSync(logFilePath, logBuffer.join(""))
          logBuffer = []
        } catch {}
      }
    },
    cleanup: () => {
      if (logFile) {
        clearInterval(logFile)
        logFile = null
      }
    },
  }
}
const getIncompleteTodos = (todos) =>
  todos.filter((t) => t.status !== "completed" && t.status !== "cancelled")
const getIncompleteCount = (todos) => getIncompleteTodos(todos).length
function buildContinuationPrompt(todos, promptFilePath) {
  const pending = getIncompleteTodos(todos)
  if (promptFilePath) {
    const todoList = pending.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`).join("\n")
    const customPrompt = loadPromptTemplate(promptFilePath, {
      incompleteCount: pending.length,
      todoList: todoList,
      totalCount: todos.length,
      completedCount: todos.length - pending.length,
    })
    if (customPrompt) {
      return customPrompt
    }
  }
  return `[SYSTEM - AUTO-CONTINUATION]

You have ${pending.length} incomplete task(s). Work on them NOW without asking for permission.

PENDING TASKS:

${pending.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`).join("\n")}

INSTRUCTIONS:

1. Pick the next pending task and execute it immediately
2. Use todowrite to mark it "in_progress" then "completed" when done
3. Continue until all tasks are complete
4. MUST work independently - you can solve everything without asking for permission.`
}
export function createTaskContinuation(ctx, options = {}) {
  const {
    countdownSeconds = 2,
    errorCooldownMs = 3000,
    toastDurationMs = 900,
    agent,
    model,
    logFilePath,
    continuationPromptFile,
  } = options
  const logger = createFileLogger(logFilePath)
  const recoveringSessions = new Set()
  const errorCooldowns = new Map()
  const pendingCountdowns = new Map()
  const sessionAgentModel = new Map()
  async function fetchTodos(sessionID) {
    try {
      const response = await ctx.client.session.todo({ path: { id: sessionID } })
      return Array.isArray(response) ? response : (response.data ?? [])
    } catch {
      return []
    }
  }
  async function fetchSessionInfo(sessionID) {
    try {
      if (typeof ctx.client.session.get === "function") {
        const sessionInfo = await ctx.client.session.get({ path: { id: sessionID } })
        if (typeof logger !== "undefined" && logger) {
          logger.debug("Raw session.get response", {
            sessionID,
            response: JSON.stringify(sessionInfo),
            keys: Object.keys(sessionInfo ?? {}),
            hasAgent: !!sessionInfo?.agent,
            hasModel: !!sessionInfo?.model,
            agentValue: sessionInfo?.agent,
            modelValue: sessionInfo?.model,
            modelType: typeof sessionInfo?.model,
          })
        }
        if (sessionInfo && (sessionInfo.agent || sessionInfo.model)) {
          return {
            agent: sessionInfo.agent,
            model: sessionInfo.model,
          }
        }
      } else {
        if (typeof logger !== "undefined" && logger) {
          logger.debug("session.get method not available on client", { sessionID })
        }
      }
    } catch (error) {
      if (typeof logger !== "undefined" && logger) {
        logger.debug("Exception calling session.get", {
          sessionID,
          error: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.constructor.name : typeof error,
        })
      }
    }
    return null
  }
  async function fetchAgentModelFromMessages(sessionID) {
    try {
      if (typeof ctx.client.session.messages !== "function") {
        if (typeof logger !== "undefined" && logger) {
          logger.debug("session.messages not available", { sessionID })
        }
        return null
      }
      const messagesResponse = await ctx.client.session.messages({ path: { id: sessionID } })
      if (typeof logger !== "undefined" && logger) {
        logger.debug("Fetching agent/model from session messages", {
          sessionID,
          messageCount: messagesResponse?.length ?? 0,
        })
      }
      if (Array.isArray(messagesResponse)) {
        for (const msg of messagesResponse) {
          const msgInfo = msg.info
          if (msgInfo?.agent || msgInfo?.model) {
            if (typeof logger !== "undefined" && logger) {
              logger.debug("Found agent/model in messages", {
                sessionID,
                agent: msgInfo.agent,
                model: msgInfo.model,
                role: msgInfo.role,
              })
            }
            return {
              agent: msgInfo.agent,
              model: msgInfo.model,
            }
          }
        }
      }
      if (typeof logger !== "undefined" && logger) {
        logger.debug("No agent/model in session messages", { sessionID })
      }
    } catch (error) {
      if (typeof logger !== "undefined" && logger) {
        logger.debug("Error fetching messages for agent/model", {
          sessionID,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return null
  }
  function updateSessionAgentModel(sessionID, eventAgent, eventModel) {
    if (eventAgent || eventModel) {
      sessionAgentModel.set(sessionID, {
        agent: eventAgent,
        model: eventModel,
      })
    }
  }
  async function getAgentModel(sessionID) {
    const tracked = sessionAgentModel.get(sessionID)
    if (tracked && (tracked.agent || tracked.model)) {
      if (typeof logger !== "undefined" && logger) {
        logger.debug("Using tracked agent/model from user message", {
          sessionID,
          agent: tracked.agent,
          model: tracked.model,
        })
      }
      return tracked
    }
    const sessionInfo = await fetchSessionInfo(sessionID)
    if (sessionInfo && (sessionInfo.agent || sessionInfo.model)) {
      if (typeof logger !== "undefined" && logger) {
        logger.debug("Using agent/model from session info", {
          sessionID,
          agent: sessionInfo.agent,
          model: sessionInfo.model,
        })
      }
      return sessionInfo
    }
    const messagesInfo = await fetchAgentModelFromMessages(sessionID)
    if (messagesInfo && (messagesInfo.agent || messagesInfo.model)) {
      if (typeof logger !== "undefined" && logger) {
        logger.debug("Using agent/model from session messages", {
          sessionID,
          agent: messagesInfo.agent,
          model: messagesInfo.model,
        })
      }
      return messagesInfo
    }
    if (typeof logger !== "undefined" && logger) {
      logger.debug("Using configured agent/model (may be undefined)", {
        sessionID,
        agent: agent,
        model: model,
        note: "Session will use its default agent/model if both are undefined",
      })
    }
    return { agent: agent ?? undefined, model: model ?? undefined }
  }
  async function injectContinuation(sessionID) {
    if (typeof logger !== "undefined" && logger) {
      logger.debug("injectContinuation called", { sessionID })
    }
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }
    const todos = await fetchTodos(sessionID)
    const incompleteCount = getIncompleteCount(todos)
    if (typeof logger !== "undefined" && logger) {
      logger.debug("Checking todos for continuation", {
        sessionID,
        totalTodos: todos.length,
        incompleteCount,
      })
    }
    if (incompleteCount === 0) {
      if (typeof logger !== "undefined" && logger) {
        logger.debug("No incomplete tasks, skipping continuation", { sessionID })
      }
      return
    }
    const prompt = buildContinuationPrompt(todos, continuationPromptFile)
    let agentModel = null
    let attempts = 0
    const maxAttempts = 10
    while (!agentModel || (!agentModel.agent && !agentModel.model && attempts < maxAttempts)) {
      if (attempts > 0) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      agentModel = await getAgentModel(sessionID)
      if (agentModel && (agentModel.agent || agentModel.model)) {
        break
      }
      attempts++
      if (typeof logger !== "undefined" && logger) {
        logger.debug("Polling for agent/model", {
          sessionID,
          attempt: attempts,
          maxAttempts,
          hasAgent: !!agentModel?.agent,
          hasModel: !!agentModel?.model,
        })
      }
    }
    const continuationAgent = agentModel?.agent
    const continuationModel = agentModel?.model
    if (typeof logger !== "undefined" && logger) {
      logger.debug("Injecting continuation prompt", {
        sessionID,
        agent: continuationAgent,
        model: continuationModel,
        modelType: typeof continuationModel,
        promptLength: prompt.length,
        promptPreview: prompt.substring(0, 100) + "...",
      })
    }
    try {
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: continuationAgent,
          model: continuationModel,
          parts: [{ type: "text", text: prompt }],
        },
        query: { directory: ctx.directory },
      })
      if (typeof logger !== "undefined" && logger) {
        logger.debug("Continuation prompt injected successfully", { sessionID })
      }
    } catch (error) {
      if (typeof logger !== "undefined" && logger) {
        logger.error(`Failed to inject continuation for session ${sessionID}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  async function scheduleContinuation(sessionID) {
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }
    const timeout = setTimeout(async () => {
      pendingCountdowns.delete(sessionID)
      try {
        if (typeof logger !== "undefined" && logger) {
          logger.debug("Countdown timer fired, injecting continuation", { sessionID })
        }
        await injectContinuation(sessionID)
      } catch (error) {
        if (typeof logger !== "undefined" && logger) {
          logger.error(`Error in continuation timeout callback for session ${sessionID}`, {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }, countdownSeconds * 1000)
    pendingCountdowns.set(sessionID, timeout)
    if (typeof logger !== "undefined" && logger) {
      logger.debug("Countdown timer scheduled", { sessionID, countdownSeconds })
    }
    try {
      await ctx.client.tui.showToast({
        body: {
          title: "Auto-Continuing",
          message: `Continuing in ${countdownSeconds} seconds...`,
          variant: "info",
          duration: toastDurationMs,
        },
      })
    } catch {}
  }
  const handleSessionIdle = async (sessionID) => {
    if (recoveringSessions.has(sessionID)) {
      return
    }
    const lastError = errorCooldowns.get(sessionID) ?? 0
    if (Date.now() - lastError < errorCooldownMs) {
      return
    }
    const todos = await fetchTodos(sessionID)
    const incompleteCount = getIncompleteCount(todos)
    if (typeof logger !== "undefined" && logger) {
      logger.debug("Session idle - checking todos", {
        sessionID,
        totalTodos: todos.length,
        incompleteCount,
      })
    }
    if (incompleteCount === 0) {
      const { agent: completionAgent, model: completionModel } = await getAgentModel(sessionID)
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: completionAgent,
          model: completionModel,
          noReply: true,
          parts: [{ type: "text", text: "All tasks completed!", ignored: true }],
        },
        query: { directory: ctx.directory },
      })
      return
    }
    scheduleContinuation(sessionID)
  }
  const handleSessionError = async (sessionID) => {
    errorCooldowns.set(sessionID, Date.now())
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }
  }
  const handleUserMessage = async (sessionID, event) => {
    if (typeof logger !== "undefined" && logger) {
      logger.debug("handleUserMessage called", {
        sessionID,
        eventType: event?.type,
        hasProperties: !!event?.properties,
        propertiesKeys: event?.properties ? Object.keys(event.properties) : [],
        hasInfo: !!event?.properties?.info,
        infoKeys: event?.properties?.info ? Object.keys(event.properties.info) : [],
        rawEvent: JSON.stringify(event),
      })
    }
    errorCooldowns.delete(sessionID)
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }
    if (event?.properties?.info) {
      const info = event.properties.info
      if (typeof logger !== "undefined" && logger) {
        logger.debug("Processing message event info", {
          sessionID,
          infoType: typeof info,
          infoKeys: Object.keys(info ?? {}),
          agentField: info?.agent,
          modelField: info?.model,
          roleField: info?.role,
          fullInfo: JSON.stringify(info),
        })
      }
      const messageAgent = info.agent
      const messageModel = info.model
      if (messageAgent || messageModel) {
        if (typeof logger !== "undefined" && logger) {
          logger.debug("Captured agent/model from message", {
            sessionID,
            agent: messageAgent,
            model: messageModel,
          })
        }
        updateSessionAgentModel(sessionID, messageAgent, messageModel)
      }
    }
  }
  const handleSessionDeleted = async (sessionID) => {
    recoveringSessions.delete(sessionID)
    errorCooldowns.delete(sessionID)
    sessionAgentModel.delete(sessionID)
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
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
  const handler = async ({ event }) => {
    const sessionID = extractSessionID(event)
    if (!sessionID) return
    switch (event.type) {
      case "session.idle":
        await handleSessionIdle(sessionID)
        break
      case "session.error":
        await handleSessionError(sessionID)
        break
      case "message.updated":
        await handleUserMessage(sessionID, event)
        break
      case "session.deleted":
        await handleSessionDeleted(sessionID)
        break
    }
  }
  const markRecovering = (sessionID) => {
    recoveringSessions.add(sessionID)
  }
  const markRecoveryComplete = (sessionID) => {
    recoveringSessions.delete(sessionID)
  }
  const cancel = (sessionID) => {
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }
    errorCooldowns.delete(sessionID)
    recoveringSessions.delete(sessionID)
  }
  const cleanup = async () => {
    for (const timeout of pendingCountdowns.values()) {
      clearTimeout(timeout)
    }
    pendingCountdowns.clear()
    recoveringSessions.clear()
    errorCooldowns.clear()
    sessionAgentModel.clear()
    logger.flush()
    logger.cleanup()
  }
  return {
    handler,
    markRecovering,
    markRecoveryComplete,
    cancel,
    cleanup,
  }
}
//# sourceMappingURL=task-continuation.js.map
