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
  } = options

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
        return {
          agent: sessionInfo.agent,
          model: sessionInfo.model,
        }
      }
    } catch {
      // Ignore errors when fetching session info
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
    agent?: string
    model?: string | { providerID: string; modelID: string }
  }> {
    const tracked = sessionAgentModel.get(sessionID)
    if (tracked && (tracked.agent || tracked.model)) {
      return tracked
    }

    // Try to get agent/model from session info
    const sessionInfo = await fetchSessionInfo(sessionID)
    if (sessionInfo && (sessionInfo.agent || sessionInfo.model)) {
      return sessionInfo
    }

    // Fallback to configured values
    return { agent, model }
  }

  async function injectContinuation(sessionID: string): Promise<void> {
    // Clear any pending countdown
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }

    const todos = await fetchTodos(sessionID)
    const incompleteCount = getIncompleteCount(todos)
    if (incompleteCount === 0) return

    const prompt = buildContinuationPrompt(todos)
    const { agent: continuationAgent, model: continuationModel } = await getAgentModel(sessionID)

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
    } catch (error) {
      // Log errors when injecting continuation for debugging
      console.error(
        `[task-continuation] Failed to inject continuation for session ${sessionID}:`,
        error
      )
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
        await injectContinuation(sessionID)
      } catch (error) {
        console.error(
          `[task-continuation] Error in continuation timeout callback for session ${sessionID}:`,
          error
        )
      }
    }, countdownSeconds * 1000)

    pendingCountdowns.set(sessionID, timeout)

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
      // The agent/model might be in the info object or in the event properties
      const messageAgent = (info as { agent?: string }).agent
      const messageModel = (info as { model?: string | ModelSpec }).model

      if (messageAgent || messageModel) {
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
  }

  return {
    handler,
    markRecovering,
    markRecoveryComplete,
    cancel,
    cleanup,
  }
}
