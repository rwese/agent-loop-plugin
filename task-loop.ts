/**
 * Task Loop - Task Continuation Loop
 *
 * Automatically continues sessions when incomplete tasks remain.
 * This loop monitors session.idle events and injects continuation prompts
 * to keep the agent working until all tasks are complete.
 */

import type { PluginContext, Todo, LoopEvent, TaskLoopOptions } from "./types"
import { isAbortError, log } from "./utils"

const HOOK_NAME = "task-loop"

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
  const { countdownSeconds = 2, errorCooldownMs = 3000, toastDurationMs = 900 } = options

  const sessions = new Map<string, SessionState>()

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
    log(`[${HOOK_NAME}] Session marked as recovering`, { sessionID })
  }

  const markRecoveryComplete = (sessionID: string): void => {
    const state = sessions.get(sessionID)
    if (state) {
      state.isRecovering = false
      log(`[${HOOK_NAME}] Session recovery complete`, { sessionID })
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

  function getIncompleteCount(todos: Todo[]): number {
    return todos.filter((t) => t.status !== "completed" && t.status !== "cancelled").length
  }

  async function injectContinuation(
    sessionID: string,
    incompleteCount: number,
    total: number
  ): Promise<void> {
    const state = sessions.get(sessionID)

    if (state?.isRecovering) {
      log(`[${HOOK_NAME}] Skipped injection: in recovery`, { sessionID })
      return
    }

    if (state?.lastErrorAt && Date.now() - state.lastErrorAt < errorCooldownMs) {
      log(`[${HOOK_NAME}] Skipped injection: recent error`, { sessionID })
      return
    }

    let todos: Todo[] = []
    try {
      const response = await ctx.client.session.todo({
        path: { id: sessionID },
      })
      todos = Array.isArray(response) ? response : (response.data ?? [])
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to fetch todos`, {
        sessionID,
        error: String(err),
      })
      return
    }

    const freshIncompleteCount = getIncompleteCount(todos)
    if (freshIncompleteCount === 0) {
      log(`[${HOOK_NAME}] Skipped injection: no incomplete todos`, {
        sessionID,
      })
      return
    }

    const prompt = `${CONTINUATION_PROMPT}\n\n[Status: ${
      todos.length - freshIncompleteCount
    }/${todos.length} completed, ${freshIncompleteCount} remaining]`

    try {
      log(`[${HOOK_NAME}] Injecting continuation`, {
        sessionID,
        incompleteCount: freshIncompleteCount,
      })

      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          parts: [{ type: "text", text: prompt }],
        },
        query: { directory: ctx.directory },
      })

      log(`[${HOOK_NAME}] Injection successful`, { sessionID })
    } catch (err) {
      log(`[${HOOK_NAME}] Injection failed`, { sessionID, error: String(err) })
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

    log(`[${HOOK_NAME}] Countdown started`, {
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

      log(`[${HOOK_NAME}] session.error`, {
        sessionID,
        isAbort: isAbortError(props?.error),
      })
      return
    }

    // Handle session idle - main trigger for continuation
    if (event.type === "session.idle") {
      const sessionID = props?.sessionID
      if (!sessionID) return

      log(`[${HOOK_NAME}] session.idle`, { sessionID })

      const state = getState(sessionID)

      if (state.isRecovering) {
        log(`[${HOOK_NAME}] Skipped: in recovery`, { sessionID })
        return
      }

      if (state.lastErrorAt && Date.now() - state.lastErrorAt < errorCooldownMs) {
        log(`[${HOOK_NAME}] Skipped: recent error (cooldown)`, { sessionID })
        return
      }

      let todos: Todo[] = []
      try {
        const response = await ctx.client.session.todo({
          path: { id: sessionID },
        })
        todos = Array.isArray(response) ? response : (response.data ?? [])
      } catch (err) {
        log(`[${HOOK_NAME}] Todo fetch failed`, {
          sessionID,
          error: String(err),
        })
        return
      }

      if (!todos || todos.length === 0) {
        log(`[${HOOK_NAME}] No todos`, { sessionID })
        return
      }

      const incompleteCount = getIncompleteCount(todos)
      if (incompleteCount === 0) {
        log(`[${HOOK_NAME}] All todos complete`, {
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
        }
        cancelCountdown(sessionID)
        log(`[${HOOK_NAME}] User message: cleared error state`, { sessionID })
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
        log(`[${HOOK_NAME}] Session deleted: cleaned up`, {
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
