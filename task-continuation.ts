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
 * - Error cooldown prevents infinite loops
 * - User messages cancel pending continuations
 *
 * ## Usage
 *
 * ```typescript
 * import { createTaskLoop } from './task-continuation';
 *
 * export default function myPlugin(ctx: PluginContext) {
 *   const taskLoop = createTaskLoop(ctx, {
 *     countdownSeconds: 3,
 *     errorCooldownMs: 5000,
 *   });
 *
 *   ctx.on('event', taskLoop.handler);
 *
 *   return { taskLoop };
 * }
 * ```
 */

import type { PluginContext, Todo, LoopEvent } from "./types.js"

// ===========================================================================
// Types
// ===========================================================================

/** Configuration options for the task continuation plugin */
export interface TaskContinuationOptions {
  /** Seconds to wait before auto-continuing (default: 2) */
  countdownSeconds?: number
  /** Cooldown period in ms after errors (default: 3000) */
  errorCooldownMs?: number
  /** Toast duration in ms (default: 900) */
  toastDurationMs?: number
  /** Agent name to use when prompting */
  agent?: string
  /** Model name to use when prompting */
  model?: string
}

/** Public interface returned by createTaskLoop */
export interface TaskContinuation {
  /** Event handler to wire into plugin event system */
  handler: (input: { event: LoopEvent }) => Promise<void>
  /** Mark session as recovering from error */
  markRecovering: (sessionID: string) => void
  /** Mark session recovery complete */
  markRecoveryComplete: (sessionID: string) => void
  /** Clean up session state */
  cleanup: (sessionID: string) => void
}

// ===========================================================================
// Utilities
// ===========================================================================

/** Filter todos to get only incomplete ones */
const getIncompleteTodos = (todos: Todo[]) =>
  todos.filter((t) => t.status !== "completed" && t.status !== "cancelled")

/** Count incomplete todos */
const getIncompleteCount = (todos: Todo[]): number => getIncompleteTodos(todos).length

/** Build the continuation prompt */
function buildContinuationPrompt(todos: Todo[], agent?: string): string {
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

/**
 * Create a task continuation plugin
 *
 * @param ctx - The OpenCode plugin context
 * @param options - Configuration options
 * @returns TaskContinuation instance with handler and control methods
 */
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
  } = options

  // Per-session state
  const sessions = new Map<
    string,
    {
      lastErrorAt?: number
      countdownTimer?: ReturnType<typeof setTimeout>
      countdownInterval?: ReturnType<typeof setInterval>
      isRecovering?: boolean
      completionShown?: boolean
    }
  >()

  /** Get or create session state */
  function getState(sessionID: string) {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }

  /** Cancel any pending countdown */
  function cancelCountdown(sessionID: string): void {
    const state = sessions.get(sessionID)
    if (!state) return

    if (state.countdownTimer) clearTimeout(state.countdownTimer)
    if (state.countdownInterval) clearInterval(state.countdownInterval)
    state.countdownTimer = undefined
    state.countdownInterval = undefined
  }

  /** Clean up session state */
  function cleanup(sessionID: string): void {
    cancelCountdown(sessionID)
    sessions.delete(sessionID)
  }

  /** Show a toast notification */
  async function showToast(
    title: string,
    message: string,
    variant: "info" | "success" | "warning" | "error"
  ): Promise<void> {
    await ctx.client.tui
      .showToast({ body: { title, message, variant, duration: toastDurationMs } })
      .catch(() => {})
  }

  /** Send status message to session (ignored by AI) */
  async function sendStatus(sessionID: string, text: string): Promise<void> {
    try {
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent,
          model,
          noReply: true,
          parts: [{ type: "text", text, ignored: true }],
        },
        query: { directory: ctx.directory },
      })
    } catch {
      // Silently ignore messaging errors
    }
  }

  /** Fetch todos for a session */
  async function fetchTodos(sessionID: string): Promise<Todo[]> {
    try {
      const response = await ctx.client.session.todo({ path: { id: sessionID } })
      return Array.isArray(response) ? response : (response.data ?? [])
    } catch {
      return []
    }
  }

  /** Check if session is in cooldown */
  function isInCooldown(sessionID: string): boolean {
    const state = sessions.get(sessionID)
    if (state?.isRecovering) return true
    if (state?.lastErrorAt && Date.now() - state.lastErrorAt < errorCooldownMs) return true
    return false
  }

  /** Inject continuation prompt */
  async function injectContinuation(sessionID: string): Promise<void> {
    if (isInCooldown(sessionID)) return

    const todos = await fetchTodos(sessionID)
    const incompleteCount = getIncompleteCount(todos)

    if (incompleteCount === 0) return

    const prompt = buildContinuationPrompt(todos)

    try {
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: { agent, model, parts: [{ type: "text", text: prompt }] },
        query: { directory: ctx.directory },
      })
    } catch {
      // Silently ignore injection errors
    }
  }

  /** Start countdown before continuation */
  async function startCountdown(
    sessionID: string,
    incompleteCount: number,
    total: number
  ): Promise<void> {
    const state = getState(sessionID)

    // Cancel any existing countdown
    if (state.countdownTimer) cancelCountdown(sessionID)

    // Show initial toast
    await showToast(
      "Task Continuation",
      `${incompleteCount} incomplete task(s). Continuing in ${countdownSeconds}s...`,
      "info"
    )

    // Update toast countdown
    let secondsLeft = countdownSeconds
    state.countdownInterval = setInterval(async () => {
      secondsLeft--
      if (secondsLeft > 0) {
        await showToast(
          "Task Continuation",
          `${incompleteCount} incomplete task(s). Continuing in ${secondsLeft}s...`,
          "info"
        )
      }
    }, 1000)

    // Inject continuation after delay
    state.countdownTimer = setTimeout(async () => {
      cancelCountdown(sessionID)
      await injectContinuation(sessionID)
    }, countdownSeconds * 1000)
  }

  /** Handle session idle event */
  const handleSessionIdle = async (sessionID: string): Promise<void> => {
    if (isInCooldown(sessionID)) return

    const todos = await fetchTodos(sessionID)
    const state = getState(sessionID)
    const incompleteCount = getIncompleteCount(todos)

    if (incompleteCount === 0) {
      if (!state.completionShown) {
        state.completionShown = true
        await sendStatus(sessionID, `✅ All ${todos.length} tasks completed!`)
      }
      return
    }

    state.completionShown = false
    await startCountdown(sessionID, incompleteCount, todos.length)
  }

  /** Handle session error */
  const handleSessionError = (sessionID: string): void => {
    const state = getState(sessionID)
    state.lastErrorAt = Date.now()
    cancelCountdown(sessionID)
  }

  /** Handle user message */
  const handleUserMessage = (sessionID: string): void => {
    const state = sessions.get(sessionID)
    if (state) {
      state.lastErrorAt = undefined
      if (state.countdownTimer) cancelCountdown(sessionID)
    }
  }

  /** Extract session ID from event */
  function extractSessionID(event: LoopEvent): string | undefined {
    const props = event.properties
    if (props?.sessionID && typeof props.sessionID === "string") return props.sessionID
    if (props?.info?.sessionID && typeof props.info.sessionID === "string")
      return props.info.sessionID
    if (props?.info?.id && typeof props.info.id === "string") return props.info.id
    return undefined
  }

  /** Main event handler */
  const handler = async ({ event }: { event: LoopEvent }): Promise<void> => {
    const sessionID = extractSessionID(event)
    if (!sessionID) return

    switch (event.type) {
      case "session.error":
        handleSessionError(sessionID)
        break

      case "session.idle":
        await handleSessionIdle(sessionID)
        break

      case "message.updated":
        if (event.properties?.info?.role === "user") {
          handleUserMessage(sessionID)
        }
        break

      case "session.deleted":
        cleanup(sessionID)
        break
    }
  }

  /** Mark session as recovering */
  const markRecovering = (sessionID: string): void => {
    const state = getState(sessionID)
    state.isRecovering = true
    cancelCountdown(sessionID)
  }

  /** Mark recovery complete */
  const markRecoveryComplete = (sessionID: string): void => {
    const state = sessions.get(sessionID)
    if (state) state.isRecovering = false
  }

  return {
    handler,
    markRecovering,
    markRecoveryComplete,
    cleanup,
  }
}

// Re-export types for convenience
export type { PluginContext, Todo, LoopEvent } from "./types.js"
