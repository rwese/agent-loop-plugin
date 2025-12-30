/**
 * Task Loop - Task Continuation Loop
 *
 * Automatically continues sessions when incomplete tasks remain.
 * This loop monitors session.idle events and injects continuation prompts
 * to keep the agent working until all tasks are complete.
 */

import type { PluginContext, Todo, LoopEvent, TaskLoopOptions, Logger } from "./types.js"
import { isAbortError, createLogger, sendIgnoredMessage, writeOutput } from "./utils.js"

const CONTINUATION_PROMPT = `[SYSTEM REMINDER - TASK CONTINUATION]

Incomplete tasks remain in your todo list. Continue working on the next pending task.

- Proceed without asking for permission
- Mark each task complete when finished
- Do not stop until all tasks are done`

interface SessionState {
  lastErrorAt?: number
  countdownTimer?: ReturnType<typeof setTimeout>
  countdownInterval?: ReturnType<typeof setInterval>
  isRecovering?: boolean
}

export interface TaskLoop {
  /** Event handler to wire into plugin event system */
  handler: (input: { event: LoopEvent }) => Promise<void>

  /** Mark session as recovering from error (prevents auto-continuation) */
  markRecovering: (sessionID: string) => void

  /** Mark session recovery complete (re-enables auto-continuation) */
  markRecoveryComplete: (sessionID: string) => void

  /** Clean up session state */
  cleanup: (sessionID: string) => void
}

/**
 * Create a Task Loop (task continuation loop)
 *
 * @example
 * ```typescript
 * const taskLoop = createTaskLoop(ctx, {
 *   countdownSeconds: 3,
 *   errorCooldownMs: 5000
 * });
 *
 * // Wire into plugin event system
 * ctx.on("event", taskLoop.handler);
 * ```
 */
export function createTaskLoop(ctx: PluginContext, options: TaskLoopOptions = {}): TaskLoop {
  const {
    countdownSeconds = 2,
    errorCooldownMs = 3000,
    toastDurationMs = 900,
    logger: customLogger,
    logLevel = "info",
    agent,
    model,
    outputFilePath,
  } = options

  const logger: Logger = createLogger(customLogger, logLevel)
  const sessions = new Map<string, SessionState>()
  const isDebug = logLevel === "debug"

  // Helper to write to output file if configured
  function logToFile(message: string, data?: Record<string, unknown>): void {
    if (outputFilePath) {
      writeOutput(ctx.directory, message, data, outputFilePath)
    }
  }

  // Show debug toast on initialization
  if (isDebug) {
    const loadedAt = new Date().toLocaleTimeString()
    ctx.client.tui
      .showToast({
        body: {
          title: "Task Loop",
          message: `Plugin loaded at ${loadedAt} (debug mode)`,
          variant: "info",
          duration: 2000,
        },
      })
      .catch(() => {})
  }

  function getState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }

  function cancelCountdown(sessionID: string): void {
    const state = sessions.get(sessionID)
    if (!state) return

    if (state.countdownTimer) {
      clearTimeout(state.countdownTimer)
      state.countdownTimer = undefined
    }
    if (state.countdownInterval) {
      clearInterval(state.countdownInterval)
      state.countdownInterval = undefined
    }
  }

  function cleanup(sessionID: string): void {
    cancelCountdown(sessionID)
    sessions.delete(sessionID)
  }

  const markRecovering = (sessionID: string): void => {
    const state = getState(sessionID)
    state.isRecovering = true
    cancelCountdown(sessionID)
    logger.debug("Skipping: session in recovery mode", { sessionID })
  }

  const markRecoveryComplete = (sessionID: string): void => {
    const state = sessions.get(sessionID)
    if (state) {
      state.isRecovering = false
      logger.debug("Session recovery complete", { sessionID })
    }
  }

  async function showCountdownToast(seconds: number, incompleteCount: number): Promise<void> {
    await ctx.client.tui
      .showToast({
        body: {
          title: "Task Continuation",
          message: `Resuming in ${seconds}s... (${incompleteCount} tasks remaining)`,
          variant: "warning",
          duration: toastDurationMs,
        },
      })
      .catch(() => {})
  }

  async function showStatusMessage(sessionID: string, message: string): Promise<void> {
    await sendIgnoredMessage(ctx.client, sessionID, message, logger, { agent, model })
  }

  function getIncompleteCount(todos: Todo[]): number {
    return todos.filter((t) => t.status !== "completed" && t.status !== "cancelled").length
  }

  async function injectContinuation(
    sessionID: string,
    _incompleteCount: number,
    total: number
  ): Promise<void> {
    const state = sessions.get(sessionID)

    if (state?.isRecovering) {
      logger.debug("Skipping: session in recovery mode", { sessionID })
      return
    }

    if (state?.lastErrorAt && Date.now() - state.lastErrorAt < errorCooldownMs) {
      logger.debug("Skipping: recent error (cooldown active)", { sessionID })
      return
    }

    let todos: Todo[] = []
    try {
      const response = await ctx.client.session.todo({
        path: { id: sessionID },
      })
      todos = Array.isArray(response) ? response : (response.data ?? [])
    } catch (err) {
      logger.error("Failed to fetch todos", {
        sessionID,
        error: String(err),
      })
      return
    }

    const freshIncompleteCount = getIncompleteCount(todos)
    if (freshIncompleteCount === 0) {
      logger.debug("Skipping: no incomplete todos", {
        sessionID,
      })
      return
    }

    const prompt = `${CONTINUATION_PROMPT}\n\n[Status: ${
      todos.length - freshIncompleteCount
    }/${todos.length} completed, ${freshIncompleteCount} remaining]`

    try {
      logger.info(`Injecting continuation prompt (${freshIncompleteCount} tasks remaining)`, {
        sessionID,
        incompleteCount: freshIncompleteCount,
        totalTasks: total,
      })
      logToFile(`Injecting continuation prompt (${freshIncompleteCount} tasks remaining)`, {
        sessionID,
        incompleteCount: freshIncompleteCount,
        totalTasks: total,
      })

      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent,
          model,
          parts: [{ type: "text", text: prompt }],
        },
        query: { directory: ctx.directory },
      })

      logger.info("Continuation prompt injected successfully", { sessionID })
      logToFile("Continuation prompt injected successfully", { sessionID })
    } catch (err) {
      logger.error("Failed to inject continuation prompt", {
        sessionID,
        error: String(err),
      })
      logToFile("Failed to inject continuation prompt", {
        sessionID,
        error: String(err),
      })
    }
  }

  function startCountdown(sessionID: string, incompleteCount: number, total: number): void {
    const state = getState(sessionID)
    cancelCountdown(sessionID)

    let secondsRemaining = countdownSeconds
    showCountdownToast(secondsRemaining, incompleteCount)

    state.countdownInterval = setInterval(() => {
      secondsRemaining--
      if (secondsRemaining > 0) {
        showCountdownToast(secondsRemaining, incompleteCount)
      }
    }, 1000)

    state.countdownTimer = setTimeout(() => {
      cancelCountdown(sessionID)
      injectContinuation(sessionID, incompleteCount, total)
    }, countdownSeconds * 1000)

    logger.debug("Starting countdown for task continuation...", {
      sessionID,
      seconds: countdownSeconds,
      incompleteCount,
    })
  }

  const handler = async ({ event }: { event: LoopEvent }): Promise<void> => {
    const props = event.properties

    // Handle session errors
    if (event.type === "session.error") {
      const sessionID = props?.sessionID
      if (!sessionID) return

      const state = getState(sessionID)
      state.lastErrorAt = Date.now()
      cancelCountdown(sessionID)

      logger.debug("Session error detected", {
        sessionID,
        isAbort: isAbortError(props?.error),
      })
      return
    }

    // Handle session idle - main trigger for continuation
    if (event.type === "session.idle") {
      const sessionID = props?.sessionID
      if (!sessionID) return

      logger.debug("Session idle detected", { sessionID })

      const state = getState(sessionID)

      if (state.isRecovering) {
        logger.debug("Skipping: session in recovery mode", { sessionID })
        return
      }

      if (state.lastErrorAt && Date.now() - state.lastErrorAt < errorCooldownMs) {
        logger.debug("Skipping: recent error (cooldown active)", { sessionID })
        return
      }

      let todos: Todo[] = []
      try {
        const response = await ctx.client.session.todo({
          path: { id: sessionID },
        })
        todos = Array.isArray(response) ? response : (response.data ?? [])
      } catch (err) {
        logger.error("Failed to fetch todos", {
          sessionID,
          error: String(err),
        })
        return
      }

      if (!todos || todos.length === 0) {
        logger.debug("No todos found", { sessionID })
        return
      }

      const incompleteCount = getIncompleteCount(todos)
      if (incompleteCount === 0) {
        logger.info("All todos complete", {
          sessionID,
          total: todos.length,
        })
        return
      }

      startCountdown(sessionID, incompleteCount, todos.length)
      return
    }

    // Cancel countdown on user message
    if (event.type === "message.updated") {
      const info = props?.info
      const sessionID = info?.sessionID
      const role = info?.role

      if (!sessionID) return

      if (role === "user") {
        const state = sessions.get(sessionID)
        if (state) {
          state.lastErrorAt = undefined
          if (state.countdownTimer) {
            cancelCountdown(sessionID)
            logger.debug("Countdown cancelled: user activity detected", {
              sessionID,
            })
          }
        }
      }

      if (role === "assistant") {
        cancelCountdown(sessionID)
      }
      return
    }

    // Cancel countdown on message part updates
    if (event.type === "message.part.updated") {
      const info = props?.info
      const sessionID = info?.sessionID
      const role = info?.role

      if (sessionID && role === "assistant") {
        cancelCountdown(sessionID)
      }
      return
    }

    // Cancel countdown during tool execution
    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = props?.sessionID
      if (sessionID) {
        cancelCountdown(sessionID)
      }
      return
    }

    // Clean up on session deletion
    if (event.type === "session.deleted") {
      const sessionInfo = props?.info
      if (sessionInfo?.id) {
        cleanup(sessionInfo.id)
        logger.debug("Session deleted: cleaned up", {
          sessionID: sessionInfo.id,
        })
      }
      return
    }
  }

  return {
    handler,
    markRecovering,
    markRecoveryComplete,
    cleanup,
  }
}
