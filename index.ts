/**
 * Task Continuation Plugin
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
 * ## Message Handling
 *
 * OpenCode sends multiple `message.updated` events for the same message.
 * This plugin filters genuine user input from message updates using:
 *
 * 1. **Message ID tracking** - Only process each message ID once per session
 * 2. **Summary detection** - Messages with summaries are updates, not new input
 * 3. **Role check** - Must be role="user" to cancel countdown
 *
 * This prevents message updates (adding summaries, etc.) from incorrectly
 * cancelling the countdown timer.
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

import { createLogger } from "./logger.js"
import type {
  ModelSpec,
  Todo,
  LoopEvent,
  TaskContinuationOptions,
  TaskContinuation,
  PluginContext,
  Goal,
  GoalManagementOptions,
  GoalManagement,
} from "./types.js"
import { GOALS_BASE_PATH, GOAL_FILENAME } from "./types.js"

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
// Utilities
// ===========================================================================

/**
 * Check if an error represents an interruption (user cancelled/aborted)
 */
function checkInterruption(error: unknown): { isInterruption: boolean; message: string } {
  // Handle standard Error instances
  if (error instanceof Error) {
    const message = error.message ?? ""
    const isInterrupt =
      message.includes("aborted") ||
      message.includes("cancelled") ||
      message.includes("interrupted") ||
      error.name === "AbortError" ||
      error.name === "CancellationError"

    return {
      isInterruption: isInterrupt,
      message,
    }
  }

  // Handle object structures like { name: "MessageAbortedError", data: { message: "..." } }
  if (typeof error === "object" && error !== null) {
    const errorObj = error as { name?: string; data?: { message?: string } }
    const name = errorObj.name ?? ""
    const errorMessage = errorObj.data?.message ?? ""
    const message = errorMessage || name || "Object error"
    const isInterrupt =
      name.includes("Abort") ||
      name.includes("Cancel") ||
      name.includes("Interrupt") ||
      errorMessage.includes("aborted") ||
      errorMessage.includes("cancelled") ||
      errorMessage.includes("interrupted")

    return {
      isInterruption: isInterrupt,
      message,
    }
  }

  return {
    isInterruption: false,
    message: String(error),
  }
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
    goalManagement,
  } = options

  // Create logger - logs to file when path provided
  const logger = createLogger({
    logFilePath,
    source: "task-continuation",
  })

  // Track recovering sessions and error cooldowns
  const recoveringSessions = new Set<string>()
  const errorCooldowns = new Map<string, number>()

  // Track pending countdowns for cleanup
  const pendingCountdowns = new Map<string, ReturnType<typeof setTimeout>>()

  // Track the last processed message ID for each session to avoid re-processing
  // the same message multiple times (OpenCode sends multiple message.updated events
  // with the same ID for a single message as it gets updated with summary, etc.)
  const lastProcessedMessageID = new Map<string, string>()

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
      if (typeof ctx.client.session.get === "function") {
        const sessionInfo = await ctx.client.session.get({ path: { id: sessionID } })
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

        if (sessionInfo && (sessionInfo.agent || sessionInfo.model)) {
          return {
            agent: sessionInfo.agent,
            model: sessionInfo.model,
          }
        }
      }
    } catch (error) {
      logger.debug("Exception calling session.get", {
        sessionID,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : typeof error,
      })
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
        logger.debug("session.messages not available", { sessionID })
        return null
      }

      const messagesResponse = await ctx.client.session.messages({ path: { id: sessionID } })

      logger.debug("Fetching agent/model from session messages", {
        sessionID,
        messageCount: messagesResponse?.length ?? 0,
      })

      // Find the last user message with agent/model
      if (Array.isArray(messagesResponse)) {
        for (const msg of messagesResponse) {
          const msgInfo = (
            msg as { info?: { agent?: string; model?: string | ModelSpec; role?: string } }
          ).info

          if (msgInfo?.agent || msgInfo?.model) {
            logger.debug("Found agent/model in messages", {
              sessionID,
              agent: msgInfo.agent,
              model: msgInfo.model,
              role: msgInfo.role,
            })
            return {
              agent: msgInfo.agent,
              model: msgInfo.model,
            }
          }
        }
      }

      logger.debug("No agent/model in session messages", { sessionID })
    } catch (error) {
      logger.debug("Error fetching messages for agent/model", {
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
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
      logger.debug("Using tracked agent/model from user message", {
        sessionID,
        agent: tracked.agent,
        model: tracked.model,
      })
      return tracked
    }

    // Second, try to get agent/model from session info
    const sessionInfo = await fetchSessionInfo(sessionID)
    if (sessionInfo && (sessionInfo.agent || sessionInfo.model)) {
      logger.debug("Using agent/model from session info", {
        sessionID,
        agent: sessionInfo.agent,
        model: sessionInfo.model,
      })
      return sessionInfo
    }

    // Third, try to get agent/model from session messages
    const messagesInfo = await fetchAgentModelFromMessages(sessionID)
    if (messagesInfo && (messagesInfo.agent || messagesInfo.model)) {
      logger.debug("Using agent/model from session messages", {
        sessionID,
        agent: messagesInfo.agent,
        model: messagesInfo.model,
      })
      return messagesInfo
    }

    // Fourth, fall back to configured values (may be undefined)
    logger.debug("Using configured agent/model (may be undefined)", {
      sessionID,
      agent: agent,
      model: model,
      note: "Session will use its default agent/model if both are undefined",
    })
    return { agent: agent ?? undefined, model: model ?? undefined }
  }

  async function injectContinuation(sessionID: string): Promise<void> {
    logger.debug("injectContinuation called", { sessionID })

    // Clear any pending countdown
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }

    const todos = await fetchTodos(sessionID)
    const incompleteCount = getIncompleteCount(todos)

    logger.debug("Checking todos for continuation", {
      sessionID,
      totalTodos: todos.length,
      incompleteCount,
    })

    // Check for active goals if goal management is available
    let activeGoal: Goal | null = null
    let hasActiveGoal = false
    if (goalManagement) {
      activeGoal = await goalManagement.getGoal(sessionID)
      hasActiveGoal = activeGoal !== null && activeGoal.status === "active"
      
      logger.debug("Checking goals for continuation", {
        sessionID,
        hasGoal: activeGoal !== null,
        goalStatus: activeGoal?.status,
        goalTitle: activeGoal?.title,
      })
    }

    // Continue if there are incomplete todos OR active goals
    if (incompleteCount === 0 && !hasActiveGoal) {
      logger.debug("No incomplete tasks or active goals, skipping continuation", { sessionID })
      return
    }

    // Build combined continuation prompt
    let prompt = ""

    if (incompleteCount > 0) {
      prompt += buildContinuationPrompt(todos)
    }

    if (hasActiveGoal && activeGoal) {
      if (prompt.length > 0) {
        prompt += "\n\n"
      }
      prompt += `[SYSTEM - GOAL CONTINUATION]

CURRENT GOAL: ${activeGoal.title}
${activeGoal.description ? `DESCRIPTION: ${activeGoal.description}\n` : ""}
DONE CONDITION: ${activeGoal.done_condition}

INSTRUCTIONS:

1. Focus on completing the active goal above
2. Use goal_done when the goal's done condition is met
3. Work independently - you can solve everything without asking for permission.`
    }

    // Poll to get the latest agent/model with priority
    // This handles timing issues where message events may not have been processed yet
    let agentModel: {
      agent?: string | undefined
      model?: string | { providerID: string; modelID: string } | undefined
    } | null = null
    let attempts = 0
    const maxAttempts = 10

    while (!agentModel || (!agentModel.agent && !agentModel.model && attempts < maxAttempts)) {
      if (attempts > 0) {
        // Wait between polling attempts
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      // Try the full priority chain (tracked → session.get → session.messages → configured)
      agentModel = await getAgentModel(sessionID)

      // Check if we got a usable value
      if (agentModel && (agentModel.agent || agentModel.model)) {
        break
      }

      attempts++

      logger.debug("Polling for agent/model", {
        sessionID,
        attempt: attempts,
        maxAttempts,
        hasAgent: !!agentModel?.agent,
        hasModel: !!agentModel?.model,
      })
    }

    const continuationAgent = agentModel?.agent
    const continuationModel = agentModel?.model

    logger.debug("Injecting continuation prompt", {
      sessionID,
      agent: continuationAgent,
      model: continuationModel,
      modelType: typeof continuationModel,
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 100) + "...",
    })

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

      logger.debug("Continuation prompt injected successfully", { sessionID })
    } catch (error) {
      // Log errors to file when injecting continuation for debugging
      logger.error(`Failed to inject continuation for session ${sessionID}`, {
        error: error instanceof Error ? error.message : String(error),
      })
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
        logger.debug("Countdown timer fired, injecting continuation", { sessionID })
        await injectContinuation(sessionID)
      } catch (error) {
        logger.error(`Error in continuation timeout callback for session ${sessionID}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }, countdownSeconds * 1000)

    pendingCountdowns.set(sessionID, timeout)

    logger.debug("Countdown timer scheduled", { sessionID, countdownSeconds })

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
    logger.debug("Session idle - checking todos", {
      sessionID,
      totalTodos: todos.length,
      incompleteCount,
    })

    // Check for active goals if goal management is available
    let hasActiveGoal = false
    if (goalManagement) {
      const goal = await goalManagement.getGoal(sessionID)
      hasActiveGoal = goal !== null && goal.status === "active"
      
      logger.debug("Session idle - checking goals", {
        sessionID,
        hasGoal: goal !== null,
        goalStatus: goal?.status,
        goalTitle: goal?.title,
      })
    }

    // Continue if there are incomplete todos OR active goals
    if (incompleteCount === 0 && !hasActiveGoal) {
      return
    }

    scheduleContinuation(sessionID)
  }

  const handleSessionError = async (sessionID: string, event?: LoopEvent): Promise<void> => {
    // Clear any pending countdown IMMEDIATELY to prevent race conditions
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }

    // Set error cooldown
    errorCooldowns.set(sessionID, Date.now())

    // Check if this is an interruption (ESC key pressed)
    const error = event?.properties?.error
    const { isInterruption, message: errorMessage } = checkInterruption(error)

    if (isInterruption) {
      logger.debug("Session interruption detected", {
        sessionID,
        errorName: error instanceof Error ? error.name : (error as { name?: string })?.name,
        errorMessage,
      })

      // Show toast notification to acknowledge the interruption
      try {
        await ctx.client.tui.showToast({
          body: {
            title: "Session Interrupted",
            message: "Task continuation paused due to interruption",
            variant: "warning",
            duration: 2000,
          },
        })
      } catch {
        // Ignore toast errors
      }
    }
  }

  /**
   * Handle message.updated events from OpenCode.
   *
   * IMPORTANT: OpenCode sends multiple message.updated events for the same message:
   * 1. Initial message creation
   * 2. When the message gets a summary field (message update)
   * 3. When other metadata changes
   *
   * We must distinguish GENUINE new user input from message updates to avoid
   * incorrectly cancelling the countdown timer.
   *
   * Message filtering criteria:
   * - role === "user" - Must be a user message (not assistant/system)
   * - !summary - Must NOT have a summary field (messages with summaries are updates)
   * - New message ID - Must be a different ID than last processed
   *
   * Only genuine new user messages cancel the pending countdown.
   */
  const handleUserMessage = async (sessionID: string, event?: LoopEvent): Promise<void> => {
    logger.debug("handleUserMessage called", {
      sessionID,
      eventType: event?.type,
      hasProperties: !!event?.properties,
      propertiesKeys: event?.properties ? Object.keys(event.properties) : [],
      hasInfo: !!event?.properties?.info,
      infoKeys: event?.properties?.info ? Object.keys(event.properties.info) : [],
      rawEvent: JSON.stringify(event),
    })

    // Clear error cooldown on user message
    errorCooldowns.delete(sessionID)

    // Check if this message contains an error (interruption detection)
    const info = event?.properties?.info
    const messageError = (info as { error?: unknown })?.error
    if (messageError) {
      // Check if this is an interruption error
      const { isInterruption, message: errorMessage } = checkInterruption(messageError)
      const errorName = messageError instanceof Error ? messageError.name : (messageError as { name?: string })?.name ?? ""

      if (isInterruption) {
        // Cancel any pending countdown due to interruption
        const existingTimeout = pendingCountdowns.get(sessionID)
        if (existingTimeout) {
          clearTimeout(existingTimeout)
          pendingCountdowns.delete(sessionID)
        }

        // Set error cooldown
        errorCooldowns.set(sessionID, Date.now())

        logger.debug("Message interruption detected", {
          sessionID,
          errorName,
          errorMessage,
        })

        // Show toast notification
        try {
          await ctx.client.tui.showToast({
            body: {
              title: "Session Interrupted",
              message: "Task continuation paused due to interruption",
              variant: "warning",
              duration: 2000,
            },
          })
        } catch {
          // Ignore toast errors
        }
      }
    }

    // Check if this is an actual new user message (not a re-processed message)
    const messageID = (info as { id?: string })?.id
    const role = (info as { role?: string })?.role
    const summary = (info as { summary?: unknown })?.summary

    // Track this message ID as processed
    if (messageID) {
      const lastProcessed = lastProcessedMessageID.get(sessionID)
      if (lastProcessed !== messageID) {
        // This is a genuinely new message
        lastProcessedMessageID.set(sessionID, messageID)

        // Only cancel countdown for NEW user messages (role === "user")
        // AND that don't have a summary (messages with summaries are updates to existing messages)
        // This prevents the countdown from being cancelled by message updates/summaries
        if (role === "user" && !summary) {
          const existingTimeout = pendingCountdowns.get(sessionID)
          if (existingTimeout) {
            clearTimeout(existingTimeout)
            pendingCountdowns.delete(sessionID)
            logger.debug("New user message cancelled pending countdown", { sessionID, messageID })
          }
        } else if (role === "user" && summary) {
          logger.debug("Message update with summary, NOT cancelling countdown", {
            sessionID,
            messageID,
            hasSummary: !!summary,
          })
        }
      }
    } else if (role === "user" && !summary) {
      // If no message ID but role is user and no summary, treat as new message
      const existingTimeout = pendingCountdowns.get(sessionID)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
        pendingCountdowns.delete(sessionID)
        logger.debug("User message (no ID, no summary) cancelled pending countdown", {
          sessionID,
        })
      }
    }

    // Capture agent/model from user message if available
    if (event?.properties?.info) {
      const msgInfo = event.properties.info

      logger.debug("Processing message event info", {
        sessionID,
        infoType: typeof msgInfo,
        infoKeys: Object.keys(msgInfo ?? {}),
        agentField: (msgInfo as { agent?: string })?.agent,
        modelField: (msgInfo as { model?: string })?.model,
        roleField: (msgInfo as { role?: string })?.role,
        fullInfo: JSON.stringify(msgInfo),
      })

      // The agent/model might be in the info object or in the event properties
      const messageAgent = (msgInfo as { agent?: string }).agent
      const messageModel = (msgInfo as { model?: string | ModelSpec }).model

      if (messageAgent || messageModel) {
        logger.debug("Captured agent/model from message", {
          sessionID,
          agent: messageAgent,
          model: messageModel,
        })
        updateSessionAgentModel(sessionID, messageAgent, messageModel)
      }
    }
  }

  const handleSessionDeleted = async (sessionID: string): Promise<void> => {
    // Cleanup session state
    recoveringSessions.delete(sessionID)
    errorCooldowns.delete(sessionID)
    sessionAgentModel.delete(sessionID)
    lastProcessedMessageID.delete(sessionID)

    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }
  }

  /**
   * Handle session.active events - agent is now processing user input.
   * This cancels any pending continuation as the user has interrupted.
   */
  const handleSessionActive = async (sessionID: string): Promise<void> => {
    // When session becomes active, cancel any pending continuation
    // This handles the case where users interrupt the agent during processing
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)

      logger.debug("Session became active, cancelled pending countdown", { sessionID })
    }
  }

  /**
   * Handle session.busy events - agent is busy processing.
   * Similar to session.active, cancel any pending continuation.
   */
  const handleSessionBusy = async (sessionID: string): Promise<void> => {
    // When session becomes busy, cancel any pending continuation
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)

      logger.debug("Session became busy, cancelled pending countdown", { sessionID })
    }
  }

  /**
   * Handle session.status events - session status has changed.
   * This helps detect interruptions when session goes back to idle.
   */
  const handleSessionStatus = async (sessionID: string, event?: LoopEvent): Promise<void> => {
    const status = event?.properties?.status
    if (
      status &&
      typeof status === "object" &&
      "type" in status &&
      (status as { type?: string }).type === "idle"
    ) {
      // Session went back to idle - check if this was from an interruption
      // by looking at the error cooldown state
      const lastError = errorCooldowns.get(sessionID) ?? 0
      const recentError = Date.now() - lastError < 5000 // Within last 5 seconds

      if (recentError) {
        // This idle state is likely from an interruption - skip continuation

        logger.debug("Session returned to idle after recent error, skipping continuation", {
          sessionID,
          timeSinceError: Date.now() - lastError,
        })

        return
      }
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
        await handleSessionError(sessionID, event)
        break
      case "session.status":
        await handleSessionStatus(sessionID, event)
        break
      case "message.updated":
        await handleUserMessage(sessionID, event)
        break
      case "session.deleted":
        await handleSessionDeleted(sessionID)
        break
      case "session.active":
        await handleSessionActive(sessionID)
        break
      case "session.busy":
        await handleSessionBusy(sessionID)
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
    lastProcessedMessageID.clear()

    // Cleanup logger and close file
    await logger.cleanup()
  }

  return {
    handler,
    markRecovering,
    markRecoveryComplete,
    cancel,
    cleanup,
  }
}

// ============================================================================
// Goal Management
// ============================================================================

/**
 * Expand tilde path to home directory
 */
function expandHomeDir(path: string): string {
  if (path.startsWith("~")) {
    return path.replace("~", process.env.HOME ?? process.env.USERPROFILE ?? "~")
  }
  return path
}

/**
 * Get the goal file path for a session
 */
function getGoalFilePath(sessionID: string, basePath: string): string {
  const expandedBase = expandHomeDir(basePath)
  return `${expandedBase}/${sessionID}/${GOAL_FILENAME}`
}

/**
 * Create a new goal management instance
 */
export function createGoalManagement(
  options: GoalManagementOptions = {}
): GoalManagement {
  const { goalsBasePath = GOALS_BASE_PATH } = options

  // Import fs module for file operations
  const fs = import("node:fs/promises")
  const pathModule = import("node:path")

  async function readGoal(sessionID: string): Promise<Goal | null> {
    try {
      const goalPath = getGoalFilePath(sessionID, goalsBasePath)
      const fsModule = await fs
      const content = await fsModule.readFile(goalPath, "utf-8")
      const goal = JSON.parse(content) as Goal

      // Validate basic structure
      if (!goal.title || !goal.done_condition || !goal.created_at) {
        return null
      }

      // Validate status
      if (!["active", "completed"].includes(goal.status)) {
        return null
      }

      return goal
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        // File doesn't exist - no goal set
        return null
      }
      // Log other errors but return null
      console.error(`Error reading goal for session ${sessionID}:`, error)
      return null
    }
  }

  async function writeGoal(sessionID: string, goal: Goal): Promise<void> {
    try {
      const goalPath = getGoalFilePath(sessionID, goalsBasePath)
      const fsModule = await fs
      const pathMod = await pathModule

      // Ensure directory exists
      const dirPath = pathMod.dirname(goalPath)
      await fsModule.mkdir(dirPath, { recursive: true })

      // Write goal file
      await fsModule.writeFile(goalPath, JSON.stringify(goal, null, 2), "utf-8")
    } catch (error) {
      console.error(`Error writing goal for session ${sessionID}:`, error)
      throw error
    }
  }

  async function createGoal(
    sessionID: string,
    title: string,
    doneCondition: string,
    description?: string
  ): Promise<Goal> {
    const goal: Goal = {
      title,
      description,
      done_condition: doneCondition,
      status: "active",
      created_at: new Date().toISOString(),
      completed_at: null,
    }

    await writeGoal(sessionID, goal)
    return goal
  }

  async function completeGoal(sessionID: string): Promise<Goal | null> {
    const goal = await readGoal(sessionID)

    if (!goal) {
      return null
    }

    const completedGoal: Goal = {
      ...goal,
      status: "completed",
      completed_at: new Date().toISOString(),
    }

    await writeGoal(sessionID, completedGoal)
    return completedGoal
  }

  async function hasActiveGoal(sessionID: string): Promise<boolean> {
    const goal = await readGoal(sessionID)
    return goal !== null && goal.status === "active"
  }

  /**
   * Handle goal-related events from OpenCode
   */
  async function handleGoalEvent(sessionID: string, event?: LoopEvent): Promise<void> {
    const info = event?.properties?.info

    // Handle goal.set command
    if (event?.type === "command" && info) {
      const commandInfo = info as { command?: string; args?: Record<string, unknown> }

      if (commandInfo.command === "goal_set") {
        const args = commandInfo.args ?? {}
        const title = args.title as string
        const doneCondition = args.done_condition as string
        const description = args.description as string | undefined

        if (!title || !doneCondition) {
          console.error("goal_set command requires title and done_condition")
          return
        }

        await createGoal(sessionID, title, doneCondition, description)
        console.log(`Goal created for session ${sessionID}: ${title}`)
      }

      // Handle goal.done command
      if (commandInfo.command === "goal_done") {
        const completedGoal = await completeGoal(sessionID)
        if (completedGoal) {
          console.log(`Goal completed for session ${sessionID}: ${completedGoal.title}`)
        }
      }
    }
  }

  const handler = async ({ event }: { event: LoopEvent }): Promise<void> => {
    const props = event.properties
    const sessionID = props?.sessionID as string | undefined

    if (!sessionID) {
      // Try to extract from info
      const info = props?.info as { sessionID?: string } | undefined
      if (info?.sessionID) {
        await handleGoalEvent(info.sessionID, event)
      }
      return
    }

    await handleGoalEvent(sessionID, event)
  }

  const cleanup = async (): Promise<void> => {
    // Cleanup is handled by file system, no in-memory state to clean
  }

  return {
    readGoal,
    writeGoal,
    createGoal,
    completeGoal,
    getGoal: readGoal,
    hasActiveGoal,
    handler,
    cleanup,
  }
}

