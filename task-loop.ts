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
 * - **Help Agent**: Optional subagent for assistance/feedback
 *
 * ## Usage
 *
 * ```typescript
 * const taskLoop = createTaskLoop(ctx, {
 *   countdownSeconds: 3,    // Wait before continuing
 *   errorCooldownMs: 5000,  // Pause after errors
 *   helpAgent: "helper",    // Optional subagent for help
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
 * Build the continuation prompt with actual task list.
 * Includes pending tasks so the AI knows exactly what to work on.
 *
 * @param todos - Current todo list from the session
 * @param helpAgent - Optional name of a subagent for help/feedback
 * @returns Formatted continuation prompt with task list
 */
function buildContinuationPrompt(todos: Todo[], helpAgent?: string): string {
  const pending = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled")
  const taskList = pending.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`).join("\n")

  const helpSection = helpAgent
    ? `
IF YOU NEED HELP:
- Use the Task tool with subagent_type="${helpAgent}" to ask questions or get feedback
- Example: Task(prompt="I need clarification on...", subagent_type="${helpAgent}")
- Only use this if you are truly blocked - prefer making progress independently`
    : ""

  return `[SYSTEM - AUTO-CONTINUATION]

You have ${pending.length} incomplete task(s). Work on them NOW without asking for permission.

PENDING TASKS:

${taskList}

INSTRUCTIONS:

1. Pick the next pending task and execute it immediately
2. Use todowrite to mark it "in_progress" then "completed" when done
3. Continue until all tasks are complete
4. MUST work independently - you can solve everything without asking for permission.
${helpSection}`
}

/** Per-session state for managing countdowns and recovery */
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

/** Module-level session state storage (shared across instances) */
const globalSessions = new Map<string, SessionState>()
let globalStateCounter = 0

/** Task Loop public interface - returned by createTaskLoop() */
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
 *
 * @param ctx - The OpenCode plugin context
 * @param options - Configuration options for the loop
 * @returns A TaskLoop instance with handler, markRecovering, markRecoveryComplete, and cleanup methods
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
    helpAgent,
    onCountdownStart,
  } = options

  const logger: Logger = createLogger(customLogger, logLevel)
  const isDebug = logLevel === "debug"
  const useExternalTimer = !!onCountdownStart

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

  /** Get or create session state */
  function getState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      globalStateCounter++
      state = { _id: globalStateCounter }
      sessions.set(sessionID, state)
    }
    return state
  }

  /** Cancel any pending countdown for a session */
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

  /** Clean up all state for a session */
  function cleanup(sessionID: string): void {
    cancelCountdown(sessionID, "cleanup")
    sessions.delete(sessionID)
  }

  /** Enter recovery mode - pauses auto-continuation */
  const markRecovering = (sessionID: string): void => {
    const state = getState(sessionID)
    state.isRecovering = true
    cancelCountdown(sessionID, "markRecovering")
    logger.debug("Skipping: session in recovery mode", { sessionID })
  }

  /** Exit recovery mode - re-enables auto-continuation */
  const markRecoveryComplete = (sessionID: string): void => {
    const state = sessions.get(sessionID)
    if (state) {
      state.isRecovering = false
      logger.debug("[markRecoveryComplete] Session recovery complete", { sessionID })
    }
  }

  /** Show countdown toast notification */
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

  /** Display a status message in the session UI */
  async function showStatusMessage(sessionID: string, message: string): Promise<void> {
    await sendIgnoredMessage(ctx.client, sessionID, message, logger, { agent, model })
  }

  /** Count todos that are not completed or cancelled */
  function getIncompleteCount(todos: Todo[]): number {
    return todos.filter((t) => t.status !== "completed" && t.status !== "cancelled").length
  }

  /** Inject a continuation prompt to keep the AI working */
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

    const prompt = buildContinuationPrompt(todos, helpAgent)

    try {
      logger.debug(`Injecting continuation prompt (${freshIncompleteCount} tasks remaining)`, {
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

      logger.debug("Continuation prompt injected successfully", { sessionID })
      logToFile("Continuation prompt injected successfully", { sessionID })
      // Note: Don't send status message after injection - it may interfere with AI response
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

  /** Start the countdown before auto-continuation */
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
      useExternalTimer,
    })

    // If external timer callback is provided, let the plugin handle timing
    if (useExternalTimer && onCountdownStart) {
      logger.debug("[startCountdown] Using external timer callback", { sessionID })
      // Set a dummy timer to mark countdown as active
      state.countdownTimer = setTimeout(() => {}, 0) as ReturnType<typeof setTimeout>

      onCountdownStart({
        sessionID,
        incompleteCount,
        totalCount: total,
        inject: async () => {
          logger.debug("[startCountdown] External timer triggered injection", { sessionID })
          cancelCountdown(sessionID, "external-timer-complete")
          await injectContinuation(sessionID, incompleteCount, total)
        },
      })
      return
    }

    // Internal timer mode (may not work in all plugin environments)
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
    const timer = setTimeout(async () => {
      logger.debug("[startCountdown] Countdown finished, injecting continuation", {
        sessionID,
        incompleteCount,
        total,
      })
      cancelCountdown(sessionID, "countdown-complete")
      try {
        await injectContinuation(sessionID, incompleteCount, total)
      } catch (err) {
        logger.error("[startCountdown] Failed to inject continuation", {
          sessionID,
          error: String(err),
        })
      }
    }, countdownSeconds * 1000)

    if (timer.ref) {
      timer.ref()
    }
    state.countdownTimer = timer

    logger.debug("[startCountdown] Timer set", {
      sessionID,
      countdownSeconds,
      timerSet: !!state.countdownTimer,
    })
  }

  /** Main event handler - wire this into the plugin event system */
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
