/**
 * Task Continuation Plugin - Minimal single-file implementation
 *
 * Automatically continues sessions when incomplete tasks remain.
 *
 * ## Features
 *
 * - Monitors `session.idle` events
 * - Fetches todo list via OpenCode API
 * - Injects continuation prompt if incomplete tasks exist
 * - Countdown with toast notification before continuation
 * - User messages cancel pending continuations
 *
 * ## Usage
 *
 * ```typescript
 * import { createTaskContinuation } from './task-continuation';
 *
 * export default function myPlugin(ctx: PluginContext) {
 *   const taskContinuation = createTaskContinuation(ctx, {});
 *
 *   ctx.on('event', taskContinuation.handler);
 *
 *   return { taskContinuation };
 * }
 * ```
 */

import * as fs from "node:fs"
import * as path from "node:path"

// ===========================================================================
// Logging utilities - file only, minimal console output
// ===========================================================================

/**
 * Simple file logger - logs everything to file, nothing to console
 */
function createFileLogger(logFilePath?: string) {
  let logFile: ReturnType<typeof setInterval> | null = null
  let logBuffer: string[] = []

  // Initialize log file if path is provided
  if (logFilePath) {
    try {
      const logDir = path.dirname(logFilePath)
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
      }

      // Flush buffer to file every second
      logFile = setInterval(() => {
        if (logBuffer.length > 0) {
          try {
            fs.appendFileSync(logFilePath, logBuffer.join(""))
            logBuffer = []
          } catch {
            // Ignore file write errors
          }
        }
      }, 1000)
    } catch {
      // Ignore logging setup errors
    }
  }

  function log(level: string, message: string, data?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString()
    const dataStr = data ? ` ${JSON.stringify(data)}` : ""
    const logLine = `[${timestamp}] [${level}] [task-continuation] ${message}${dataStr}\n`

    // Always buffer to file
    if (logFile) {
      logBuffer.push(logLine)
    }
  }

  return {
    debug: (message: string, data?: Record<string, unknown>) => log("DEBUG", message, data),
    info: (message: string, data?: Record<string, unknown>) => log("INFO", message, data),
    warn: (message: string, data?: Record<string, unknown>) => log("WARN", message, data),
    error: (message: string, data?: Record<string, unknown>) => log("ERROR", message, data),
    flush: () => {
      if (logFile && logBuffer.length > 0) {
        try {
          fs.appendFileSync(logFilePath!, logBuffer.join(""))
          logBuffer = []
        } catch {
          // Ignore flush errors
        }
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

// ===========================================================================
// Types (minimal, inlined)
// ===========================================================================

/** Model specification following OpenCode SDK format */
interface ModelSpec {
  /** Provider ID (e.g., "anthropic", "openai") */
  providerID: string
  /** Model ID (e.g., "claude-3-5-sonnet-20241022") */
  modelID: string
}

/** Session information from OpenCode SDK */
interface SessionInfo {
  id: string
  agent?: string
  model?: string | ModelSpec
  title?: string
  status?: {
    type: "idle" | "busy"
  }
}

/** Represents a single todo/task item */
export interface Todo {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: string
}

/** Represents an event from the OpenCode plugin system */
export interface LoopEvent {
  type: string
  properties?: {
    sessionID?: string
    error?: unknown
    info?: {
      id?: string
      sessionID?: string
      role?: string
      agent?: string
      model?: string | ModelSpec
    }
    [key: string]: unknown
  }
}

/** Configuration options for the task continuation plugin */
export interface TaskContinuationOptions {
  /** Seconds to wait before auto-continuation (default: 2) */
  countdownSeconds?: number
  /** Cooldown period in ms after errors (default: 3000) */
  errorCooldownMs?: number
  /** Toast notification duration in ms (default: 900) */
  toastDurationMs?: number
  /** Agent name for continuation prompts */
  agent?: string
  /** Model name for continuation prompts */
  model?: string | ModelSpec
  /** Path to log file for debugging */
  logFilePath?: string
}

/** Public interface returned by createTaskContinuation */
export interface TaskContinuation {
  /** Event handler for session events */
  handler: (input: { event: LoopEvent }) => Promise<void>
  /** Mark a session as recovering (pauses auto-continuation) */
  markRecovering: (sessionID: string) => void
  /** Mark recovery as complete (resumes auto-continuation) */
  markRecoveryComplete: (sessionID: string) => void
  /** Cancel any pending continuation for a session and clear related state */
  cancel: (sessionID: string) => void
  /** Cleanup session state */
  cleanup: () => Promise<void>
}

/** Minimal plugin context interface */
interface PluginContext {
  directory: string
  client: {
    session: {
      get(opts: { path: { id: string } }): Promise<SessionInfo>
      prompt(opts: {
        path: { id: string }
        body: {
          agent?: string
          model?: string | ModelSpec
          noReply?: boolean
          parts: Array<{ type: string; text: string; ignored?: boolean }>
        }
        query?: { directory: string }
      }): Promise<void>
      todo(opts: { path: { id: string } }): Promise<Todo[] | { data: Todo[] }>
      messages(opts: { path: { id: string } }): Promise<
        Array<{
          info: {
            agent?: string
            model?: string | ModelSpec
            role?: string
            sessionID?: string
            id?: string
          }
          parts: unknown[]
        }>
      >
    }
    tui: {
      showToast(opts: {
        body: {
          title: string
          message: string
          variant: "info" | "success" | "warning" | "error"
          duration: number
        }
      }): Promise<void>
    }
  }
}

// ===========================================================================
// Utilities
// ===========================================================================

const getIncompleteTodos = (todos: Todo[]) =>
  todos.filter((t) => t.status !== "completed" && t.status !== "cancelled")

const getIncompleteCount = (todos: Todo[]): number => getIncompleteTodos(todos).length

function buildContinuationPrompt(todos: Todo[]): string {
  const pending = getIncompleteTodos(todos)
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

// ===========================================================================
// Implementation
// ===========================================================================

export function createTaskContinuation(
  ctx: PluginContext,
  options: TaskContinuationOptions = {}
): TaskContinuation {
  const {
    countdownSeconds = 2,
    errorCooldownMs = 3000,
    toastDurationMs = 900,
    agent,
    model,
    logFilePath,
  } = options

  // Create file logger - logs nothing to console
  const logger = createFileLogger(logFilePath)

  // Track recovering sessions and error cooldowns
  const recoveringSessions = new Set<string>()
  const errorCooldowns = new Map<string, number>()

  // Track pending countdowns for cleanup
  const pendingCountdowns = new Map<string, ReturnType<typeof setTimeout>>()

  // Track the last used agent/model for each session (from user messages)
  const sessionAgentModel = new Map<string, { agent?: string; model?: string | ModelSpec }>()

  async function fetchTodos(sessionID: string): Promise<Todo[]> {
    try {
      const response = await ctx.client.session.todo({ path: { id: sessionID } })
      return Array.isArray(response) ? response : (response.data ?? [])
    } catch {
      return []
    }
  }

  /**
   * Fetch session info to get the current agent/model
   */
  async function fetchSessionInfo(
    sessionID: string
  ): Promise<{ agent?: string; model?: string | ModelSpec } | null> {
    try {
      // Check if session.get method exists
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

  /**
   * Fetch agent/model from session messages as a fallback
   */
  async function fetchAgentModelFromMessages(
    sessionID: string
  ): Promise<{ agent?: string; model?: string | ModelSpec } | null> {
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

      // Find the last user message with agent/model
      if (Array.isArray(messagesResponse)) {
        for (const msg of messagesResponse) {
          const msgInfo = (
            msg as { info?: { agent?: string; model?: string | ModelSpec; role?: string } }
          ).info

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

  /**
   * Update session agent/model from user message event
   */
  function updateSessionAgentModel(
    sessionID: string,
    eventAgent?: string,
    eventModel?: string | { providerID: string; modelID: string }
  ): void {
    if (eventAgent || eventModel) {
      sessionAgentModel.set(sessionID, {
        agent: eventAgent,
        model: eventModel,
      })
    }
  }

  /**
   * Get the agent/model for a session - prefer tracked over configured, then session info
   */
  async function getAgentModel(sessionID: string): Promise<{
    agent?: string | undefined
    model?: string | { providerID: string; modelID: string } | undefined
  }> {
    // First, check if we have tracked agent/model from user messages
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

    // Second, try to get agent/model from session info
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

    // Third, try to get agent/model from session messages
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

    // Fourth, fall back to configured values (may be undefined)
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

  async function injectContinuation(sessionID: string): Promise<void> {
    if (typeof logger !== "undefined" && logger) {
      logger.debug("injectContinuation called", { sessionID })
    }

    // Clear any pending countdown
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

    const prompt = buildContinuationPrompt(todos)

    // Brief delay to allow agent/model from message events to be captured
    // This is a timing fix - message events may arrive after session.idle but before continuation
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Re-fetch agent/model right before continuation to get latest values
    const { agent: continuationAgent, model: continuationModel } = await getAgentModel(sessionID)

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
      // Log errors to file when injecting continuation for debugging
      if (typeof logger !== "undefined" && logger) {
        logger.error(`Failed to inject continuation for session ${sessionID}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  async function scheduleContinuation(sessionID: string): Promise<void> {
    // Clear any existing countdown
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    // Schedule new countdown with proper async handling
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

    // Show toast notification
    try {
      await ctx.client.tui.showToast({
        body: {
          title: "Auto-Continuing",
          message: `Continuing in ${countdownSeconds} seconds...`,
          variant: "info",
          duration: toastDurationMs,
        },
      })
    } catch {
      // Ignore toast errors
    }
  }

  const handleSessionIdle = async (sessionID: string): Promise<void> => {
    // Check if session is recovering
    if (recoveringSessions.has(sessionID)) {
      return
    }

    // Check error cooldown
    const lastError = errorCooldowns.get(sessionID) ?? 0
    if (Date.now() - lastError < errorCooldownMs) {
      return
    }

    const todos = await fetchTodos(sessionID)
    const incompleteCount = getIncompleteCount(todos)

    // Log what we found
    if (typeof logger !== "undefined" && logger) {
      logger.debug("Session idle - checking todos", {
        sessionID,
        totalTodos: todos.length,
        incompleteCount,
      })
    }

    if (incompleteCount === 0) {
      // Send completion status message
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

  const handleSessionError = async (sessionID: string): Promise<void> => {
    // Set error cooldown
    errorCooldowns.set(sessionID, Date.now())

    // Clear any pending countdown
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }
  }

  const handleUserMessage = async (sessionID: string, event?: LoopEvent): Promise<void> => {
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

    // Clear error cooldown on user message
    errorCooldowns.delete(sessionID)

    // Clear any pending countdown
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }

    // Capture agent/model from user message if available
    if (event?.properties?.info) {
      const info = event.properties.info

      if (typeof logger !== "undefined" && logger) {
        logger.debug("Processing message event info", {
          sessionID,
          infoType: typeof info,
          infoKeys: Object.keys(info ?? {}),
          agentField: (info as { agent?: string })?.agent,
          modelField: (info as { model?: string })?.model,
          roleField: (info as { role?: string })?.role,
          fullInfo: JSON.stringify(info),
        })
      }

      // The agent/model might be in the info object or in the event properties
      const messageAgent = (info as { agent?: string }).agent
      const messageModel = (info as { model?: string | ModelSpec }).model

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

  const handleSessionDeleted = async (sessionID: string): Promise<void> => {
    // Cleanup session state
    recoveringSessions.delete(sessionID)
    errorCooldowns.delete(sessionID)
    sessionAgentModel.delete(sessionID)

    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }
  }

  function extractSessionID(event: LoopEvent): string | undefined {
    const props = event.properties
    if (props?.sessionID && typeof props.sessionID === "string") return props.sessionID
    if (props?.info?.sessionID && typeof props.info.sessionID === "string")
      return props.info.sessionID
    if (props?.info?.id && typeof props.info.id === "string") return props.info.id
    return undefined
  }

  const handler = async ({ event }: { event: LoopEvent }): Promise<void> => {
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

  const markRecovering = (sessionID: string): void => {
    recoveringSessions.add(sessionID)
  }

  const markRecoveryComplete = (sessionID: string): void => {
    recoveringSessions.delete(sessionID)
  }

  const cancel = (sessionID: string): void => {
    // Clear any pending countdown
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }

    // Clear error cooldown
    errorCooldowns.delete(sessionID)

    // Remove from recovering set if present
    recoveringSessions.delete(sessionID)
  }

  const cleanup = async (): Promise<void> => {
    // Clear all pending countdowns
    for (const timeout of pendingCountdowns.values()) {
      clearTimeout(timeout)
    }
    pendingCountdowns.clear()
    recoveringSessions.clear()
    errorCooldowns.clear()
    sessionAgentModel.clear()

    // Cleanup logger - flush any pending logs and close file
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
