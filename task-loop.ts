/**
 * Task Loop - Task Continuation Loop
 *
 * Automatically continues sessions when incomplete tasks remain.
 * This loop monitors session.idle events and injects continuation prompts
 * to keep the agent working until all tasks are complete.
 *
 * ## How It Works
 *
 * 1. Monitors `session.idle` events (fires when AI stops responding)
 * 2. Fetches current todo list via OpenCode API
 * 3. If incomplete todos exist, starts a countdown (default 2 seconds)
 * 4. After countdown, injects a continuation prompt to keep AI working
 * 5. Countdown cancels if user sends a new message
 *
 * ## Key Features
 *
 * - **Countdown with Toast**: Visual feedback before auto-continuing
 * - **Error Cooldown**: Pauses continuation after errors (prevents loops)
 * - **Recovery Mode**: Can be manually paused via `markRecovering()`
 * - **User Override**: User messages cancel pending continuations
 *
 * ## Usage
 *
 * ```typescript
 * const taskLoop = createTaskLoop(ctx, {
 *   countdownSeconds: 3,    // Wait before continuing
 *   errorCooldownMs: 5000,  // Pause after errors
 * });
 *
 * // Wire into plugin event system
 * ctx.on("event", taskLoop.handler);
 * ```
 *
 * @module task-loop
 */

import type { PluginContext, Todo, LoopEvent, TaskLoopOptions, Logger } from "./types.js"
import { isAbortError, createLogger, sendIgnoredMessage, writeOutput } from "./utils.js"

/**
 * System prompt injected to continue the AI on incomplete tasks.
 * Designed to be assertive - tells AI to proceed without waiting for user.
 */
const CONTINUATION_PROMPT = `[SYSTEM REMINDER - TASK CONTINUATION]

Incomplete tasks remain in your todo list. Continue working on the next pending task.

- Proceed without asking for permission
- Mark each task complete when finished
- Do not stop until all tasks are done`

/**
 * Per-session state for managing countdowns and recovery.
 * Each active session has its own state tracked in memory.
 */
interface SessionState {
  /** Timestamp of last error (for cooldown calculation) */
  lastErrorAt?: number
  /** Timer handle for the continuation injection */
  countdownTimer?: ReturnType<typeof setTimeout>
  /** Interval handle for countdown toast updates */
  countdownInterval?: ReturnType<typeof setInterval>
  /** When true, skip continuation (manual recovery mode) */
  isRecovering?: boolean
  /** When true, completion message has been shown (prevents duplicates) */
  completionShown?: boolean
  /** When true, countdown is being started (prevents race conditions) */
  countdownStarting?: boolean
  /** Debug ID for tracking state instances */
  _id?: number
}

/**
 * Module-level session state storage.
 * Shared across all TaskLoop instances to prevent duplicate countdowns
 * when the plugin is loaded multiple times.
 */
const globalSessions = new Map<string, SessionState>()
let globalStateCounter = 0

/**
 * Task Loop public interface.
 * Returned by createTaskLoop() factory function.
 */
export interface TaskLoop {
  /**
   * Event handler to wire into plugin event system.
   * Call this for every event: `ctx.on("event", taskLoop.handler)`
   */
  handler: (input: { event: LoopEvent }) => Promise<void>

  /**
   * Mark session as recovering from error (prevents auto-continuation).
   * Use when you need to manually pause the loop.
   */
  markRecovering: (sessionID: string) => void

  /**
   * Mark session recovery complete (re-enables auto-continuation).
   * Call after manual intervention is complete.
   */
  markRecoveryComplete: (sessionID: string) => void

  /**
   * Clean up session state (timers, memory).
   * Called automatically on session.deleted, but can be called manually.
   */
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
  const isDebug = logLevel === "debug"

  // Use module-level sessions map to share state across instances
  const sessions = globalSessions

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

  /**
   * Get or create session state. Uses lazy initialization.
   * State is stored in memory (Map) and persists for session lifetime.
   */
  function getState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      globalStateCounter++
      state = { _id: globalStateCounter }
      sessions.set(sessionID, state)
    }
    return state
  }

  /**
   * Cancel any pending countdown for a session.
   * Clears both the timer (for injection) and interval (for toast updates).
   */
  function cancelCountdown(sessionID: string, reason?: string): void {
    const state = sessions.get(sessionID)
    if (!state) return

    const hadTimer = !!state.countdownTimer
    const hadInterval = !!state.countdownInterval

    if (state.countdownTimer) {
      clearTimeout(state.countdownTimer)
      state.countdownTimer = undefined
    }
    if (state.countdownInterval) {
      clearInterval(state.countdownInterval)
      state.countdownInterval = undefined
    }
    state.countdownStarting = false

    if (hadTimer || hadInterval) {
      logger.debug("[cancelCountdown] Countdown cancelled", {
        sessionID,
        reason: reason ?? "unknown",
        hadTimer,
        hadInterval,
      })
    }
  }

  /**
   * Clean up all state for a session.
   * Cancels timers and removes from memory map.
   */
  function cleanup(sessionID: string): void {
    cancelCountdown(sessionID, "cleanup")
    sessions.delete(sessionID)
  }

  /**
   * Enter recovery mode - pauses auto-continuation.
   * Use when manual intervention is needed.
   */
  const markRecovering = (sessionID: string): void => {
    const state = getState(sessionID)
    state.isRecovering = true
    cancelCountdown(sessionID, "markRecovering")
    logger.debug("Skipping: session in recovery mode", { sessionID })
  }

  /**
   * Exit recovery mode - re-enables auto-continuation.
   * Call after manual intervention is complete.
   */
  const markRecoveryComplete = (sessionID: string): void => {
    const state = sessions.get(sessionID)
    if (state) {
      state.isRecovering = false
      logger.debug("[markRecoveryComplete] Session recovery complete", { sessionID })
    }
  }

  /**
   * Show countdown toast notification.
   * Called every second during countdown to update remaining time.
   */
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

  /**
   * Display a status message in the session UI without affecting AI context.
   * Uses "ignored" message type so the AI doesn't see these status updates.
   */
  async function showStatusMessage(sessionID: string, message: string): Promise<void> {
    await sendIgnoredMessage(ctx.client, sessionID, message, logger, { agent, model })
  }

  /**
   * Count todos that are not completed or cancelled.
   * These are the tasks that need to be worked on.
   */
  function getIncompleteCount(todos: Todo[]): number {
    return todos.filter((t) => t.status !== "completed" && t.status !== "cancelled").length
  }

  /**
   * Inject a continuation prompt to keep the AI working.
   * Re-fetches todos to get fresh count before injection.
   *
   * @param sessionID - The session to continue
   * @param _incompleteCount - Initial count (re-fetched for accuracy)
   * @param total - Total todo count for status message
   */
  async function injectContinuation(
    sessionID: string,
    _incompleteCount: number,
    total: number
  ): Promise<void> {
    logger.debug("[injectContinuation] Called", { sessionID, _incompleteCount, total })

    const state = sessions.get(sessionID)

    if (state?.isRecovering) {
      logger.debug("[injectContinuation] Skipping: session in recovery mode", { sessionID })
      return
    }

    if (state?.lastErrorAt && Date.now() - state.lastErrorAt < errorCooldownMs) {
      logger.debug("[injectContinuation] Skipping: recent error (cooldown active)", {
        sessionID,
        lastErrorAt: state.lastErrorAt,
        cooldownMs: errorCooldownMs,
        timeSinceError: Date.now() - state.lastErrorAt,
      })
      return
    }

    let todos: Todo[] = []
    try {
      const response = await ctx.client.session.todo({
        path: { id: sessionID },
      })
      todos = Array.isArray(response) ? response : (response.data ?? [])
    } catch (err) {
      logger.error("[injectContinuation] Failed to fetch todos", {
        sessionID,
        error: String(err),
      })
      return
    }

    const freshIncompleteCount = getIncompleteCount(todos)
    if (freshIncompleteCount === 0) {
      logger.debug("[injectContinuation] Skipping: no incomplete todos", {
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
      await showStatusMessage(
        sessionID,
        `📋 [injectContinuation] Task Loop: Continuing with ${freshIncompleteCount} task${freshIncompleteCount > 1 ? "s" : ""} remaining`
      )
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

  /**
   * Start the countdown before auto-continuation.
   *
   * Creates two timers:
   * 1. Interval - updates toast every second
   * 2. Timeout - triggers continuation after countdown
   *
   * User messages will cancel both via cancelCountdown().
   */
  function startCountdown(sessionID: string, incompleteCount: number, total: number): void {
    const state = getState(sessionID)

    // Skip if countdown already active or being started - don't reset it
    if (state.countdownTimer || state.countdownStarting) {
      logger.debug("[startCountdown] Countdown already active, skipping", { sessionID })
      return
    }

    // Mark as starting to prevent race conditions
    state.countdownStarting = true
    logger.debug("[startCountdown] Starting countdown for task continuation...", {
      sessionID,
      seconds: countdownSeconds,
      incompleteCount,
    })

    let secondsRemaining = countdownSeconds
    showCountdownToast(secondsRemaining, incompleteCount)

    // Update toast every second
    state.countdownInterval = setInterval(() => {
      secondsRemaining--
      if (secondsRemaining > 0) {
        showCountdownToast(secondsRemaining, incompleteCount)
      }
    }, 1000)

    // Inject continuation after countdown
    state.countdownTimer = setTimeout(() => {
      logger.debug("[startCountdown] Countdown finished, injecting continuation", {
        sessionID,
        incompleteCount,
        total,
      })
      cancelCountdown(sessionID, "countdown-complete")
      injectContinuation(sessionID, incompleteCount, total)
    }, countdownSeconds * 1000)
  }

  /**
   * Main event handler - wire this into the plugin event system.
   *
   * Event handling:
   * - session.error: Record error time, cancel countdown
   * - session.idle: Check todos, start countdown if incomplete
   * - message.updated: Cancel countdown on user messages
   * - session.deleted: Clean up state
   */
  const handler = async ({ event }: { event: LoopEvent }): Promise<void> => {
    const props = event.properties

    // Handle session errors - record time for cooldown calculation
    if (event.type === "session.error") {
      const sessionID = props?.sessionID
      if (!sessionID) return

      const state = getState(sessionID)
      state.lastErrorAt = Date.now()
      cancelCountdown(sessionID, "session-error")

      logger.debug("[session.error] Session error detected", {
        sessionID,
        isAbort: isAbortError(props?.error),
      })
      return
    }

    // Handle session idle - main trigger for continuation
    if (event.type === "session.idle") {
      const sessionID = props?.sessionID
      if (!sessionID) return

      logger.debug("[session.idle] Session idle detected", { sessionID })

      const state = getState(sessionID)

      if (state.isRecovering) {
        logger.debug("[session.idle] Skipping: session in recovery mode", { sessionID })
        return
      }

      if (state.lastErrorAt && Date.now() - state.lastErrorAt < errorCooldownMs) {
        logger.debug("[session.idle] Skipping: recent error (cooldown active)", { sessionID })
        return
      }

      let todos: Todo[] = []
      try {
        const response = await ctx.client.session.todo({
          path: { id: sessionID },
        })
        todos = Array.isArray(response) ? response : (response.data ?? [])
      } catch (err) {
        logger.error("[session.idle] Failed to fetch todos", {
          sessionID,
          error: String(err),
        })
        return
      }

      if (!todos || todos.length === 0) {
        logger.debug("[session.idle] No todos found", { sessionID })
        return
      }

      const incompleteCount = getIncompleteCount(todos)
      if (incompleteCount === 0) {
        // Only show completion message once per session
        if (!state.completionShown) {
          state.completionShown = true
          logger.info("[session.idle] All todos complete", {
            sessionID,
            total: todos.length,
          })
          await showStatusMessage(sessionID, `✅ Task Loop: All ${todos.length} tasks completed!`)
        }
        return
      }

      // Reset completion flag when there are incomplete tasks
      state.completionShown = false

      startCountdown(sessionID, incompleteCount, todos.length)
      return
    }

    // Cancel countdown on user message only
    // Note: We only cancel on user messages, not assistant messages.
    // session.idle fires after the assistant is done, so we don't want
    // late-arriving message.updated events to cancel our countdown.
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
            cancelCountdown(sessionID, "user-message")
          }
        }
      }
      return
    }

    // Clean up on session deletion
    if (event.type === "session.deleted") {
      const sessionInfo = props?.info
      if (sessionInfo?.id) {
        cleanup(sessionInfo.id)
        logger.debug("[session.deleted] Session deleted: cleaned up", {
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
