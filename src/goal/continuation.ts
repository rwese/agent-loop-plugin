/**
 * Task Continuation Logic
 *
 * Handles automatic continuation of sessions when incomplete tasks remain.
 */

import type {
  PluginContext,
  TaskContinuationOptions,
  TaskContinuation,
  Todo,
  LoopEvent,
  Goal,
  ModelSpec,
} from "../types.js"
import { createLogger } from "../logger.js"
import { promptWithContext } from "../session-context.js"

const log = createLogger("task-continuation")

/**
 * Get incomplete todos from a list
 */
function getIncompleteTodos(todos: Todo[]): Todo[] {
  return todos.filter((t) => t.status !== "completed" && t.status !== "cancelled")
}

/**
 * Get count of incomplete todos
 */
function getIncompleteCount(todos: Todo[]): number {
  return getIncompleteTodos(todos).length
}

/**
 * Build continuation prompt for incomplete todos
 */
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

/**
 * Check if an error represents an interruption
 */
function checkInterruption(error: unknown): { isInterruption: boolean; message: string } {
  // Handle standard Error instances
  if (error instanceof Error) {
    const message = error.message ?? ""
    const isInterrupt =
      message.includes("aborted") ||
      message.includes("cancelled") ||
      message.includes("interrupted") ||
      message.includes("canceled") ||
      message.includes("stop") ||
      message.includes("stopped") ||
      message.includes("terminate") ||
      message.includes("terminated") ||
      message.includes("quit") ||
      message.includes("exit") ||
      error.name === "AbortError" ||
      error.name === "CancellationError" ||
      error.name === "ExitError" ||
      error.name === "TerminateError"

    return {
      isInterruption: isInterrupt,
      message,
    }
  }

  // Handle object structures
  if (typeof error === "object" && error !== null) {
    const errorObj = error as {
      name?: string
      data?: { message?: string }
      code?: string
      signal?: string
    }
    const name = errorObj.name ?? ""
    const errorMessage = errorObj.data?.message ?? ""
    const code = errorObj.code ?? ""
    const signal = errorObj.signal ?? ""
    const message = errorMessage || name || code || signal || "Object error"
    const isInterrupt =
      name.includes("Abort") ||
      name.includes("Cancel") ||
      name.includes("Interrupt") ||
      name.includes("Exit") ||
      name.includes("Terminate") ||
      code.includes("cancel") ||
      code.includes("abort") ||
      code.includes("exit") ||
      code.includes("terminate") ||
      signal?.includes("SIGTERM") ||
      signal?.includes("SIGINT") ||
      signal?.includes("SIGKILL") ||
      errorMessage.includes("aborted") ||
      errorMessage.includes("cancelled") ||
      errorMessage.includes("canceled") ||
      errorMessage.includes("interrupted") ||
      errorMessage.includes("stopped") ||
      errorMessage.includes("terminated")

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

/**
 * Check if a message represents user cancellation
 */
function checkMessageCancellation(message: string): boolean {
  if (!message || typeof message !== "string") return false

  const lowerMessage = message.toLowerCase()
  const cancellationPatterns = [
    /cancel\s+(this\s+)?(task|goal|operation|execution)/i,
    /stop\s+(this\s+)?(task|goal|operation|execution)/i,
    /abort\s+(this\s+)?(task|goal|operation|execution)/i,
    /terminate\s+(this\s+)?(task|goal|operation|execution)/i,
    /don't\s+do\s+(this|that)/i,
    /never\s+mind/i,
    /skip\s+this/i,
    /i\s+changed\s+my\s+mind/i,
    /that's\s+all/i,
    /that's\s+enough/i,
    /enough\s+(with\s+)?(this|that)/i,
    /please\s+stop/i,
    /please\s+cancel/i,
    /please\s+abort/i,
    /never\s+mind/i,
    /on\s+second\s+thought/i,
    /actually,\s+don't/i,
    /actually,\s+stop/i,
    /wait,\s+cancel/i,
    /wait,\s+stop/i,
  ]

  return cancellationPatterns.some((pattern) => pattern.test(lowerMessage))
}

/**
 * Create task continuation instance
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
    goalManagement,
  } = options

  // Track sessions and state
  const recoveringSessions = new Set<string>()
  const errorCooldowns = new Map<string, number>()
  const pendingCountdowns = new Map<string, ReturnType<typeof setTimeout>>()
  const lastProcessedMessageID = new Map<string, string>()
  const sessionAgentModel = new Map<string, { agent?: string; model?: string | ModelSpec }>()
  // Track pending cancellations to prevent race conditions
  const pendingCancellations = new Set<string>()
  // Track message timestamps for better deduplication
  const messageTimestamps = new Map<string, number>()

  async function fetchTodos(sessionID: string): Promise<Todo[]> {
    try {
      const response = await ctx.client.session.todo({ path: { id: sessionID } })
      const todos = Array.isArray(response) ? response : (response.data ?? [])
      // Ensure todos match our Todo interface
      return todos.map((todo) => ({
        id: todo.id,
        content: todo.content,
        status: todo.status as "pending" | "in_progress" | "completed" | "cancelled",
        priority: todo.priority,
      }))
    } catch {
      return []
    }
  }

  async function fetchSessionInfo(
    sessionID: string
  ): Promise<{ agent?: string; model?: string | { providerID: string; modelID: string } } | null> {
    try {
      if (typeof ctx.client.session.get === "function") {
        const sessionInfo = await ctx.client.session.get({ path: { id: sessionID } })

        // Handle the response structure - extract from data property if present
        const sessionData = (
          sessionInfo as {
            data?: { agent?: string; model?: string | { providerID: string; modelID: string } }
          }
        ).data
        const sessionObj = sessionInfo as {
          agent?: string
          model?: string | { providerID: string; modelID: string }
        }
        const agent = sessionData?.agent || sessionObj.agent
        const model = sessionData?.model || sessionObj.model

        if (agent || model) {
          return { agent, model }
        }
      }
    } catch {
      log.debug("Exception calling session.get", { sessionID })
    }
    return null
  }

  async function fetchAgentModelFromMessages(
    sessionID: string
  ): Promise<{ agent?: string; model?: string | ModelSpec } | null> {
    try {
      if (typeof ctx.client.session.messages !== "function") {
        return null
      }

      const messagesResponse = await ctx.client.session.messages({ path: { id: sessionID } })

      if (Array.isArray(messagesResponse)) {
        for (const msg of messagesResponse) {
          const msgInfo = (
            msg as { info?: { agent?: string; model?: string | ModelSpec; role?: string } }
          ).info

          if (msgInfo?.agent || msgInfo?.model) {
            return {
              agent: msgInfo.agent,
              model: msgInfo.model,
            }
          }
        }
      }
    } catch {
      log.debug("Error fetching messages for agent/model", { sessionID })
    }
    return null
  }

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

  async function getAgentModel(sessionID: string): Promise<{
    agent?: string | undefined
    model?: string | { providerID: string; modelID: string } | undefined
  }> {
    const tracked = sessionAgentModel.get(sessionID)
    if (tracked && (tracked.agent || tracked.model)) {
      return tracked
    }

    const sessionInfo = await fetchSessionInfo(sessionID)
    if (sessionInfo && (sessionInfo.agent || sessionInfo.model)) {
      return sessionInfo
    }

    const messagesInfo = await fetchAgentModelFromMessages(sessionID)
    if (messagesInfo && (messagesInfo.agent || messagesInfo.model)) {
      return messagesInfo
    }

    return { agent: agent ?? undefined, model: model ?? undefined }
  }

  /**
   * Atomically cancel a countdown and mark session as cancelled.
   * Returns true if a countdown was actually cancelled.
   */
  function cancelCountdownAtomic(sessionID: string, reason: string): boolean {
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
      pendingCancellations.add(sessionID)
      errorCooldowns.set(sessionID, Date.now())
      log.debug("Countdown cancelled atomically", { sessionID, reason })
      return true
    }
    return false
  }

  /**
   * Check if a session has a pending cancellation
   */
  function hasPendingCancellation(sessionID: string): boolean {
    return pendingCancellations.has(sessionID)
  }

  /**
   * Clear cancellation state for a session (e.g., when user sends new non-cancel message)
   */
  function clearCancellationState(sessionID: string): void {
    pendingCancellations.delete(sessionID)
  }

  async function injectContinuation(sessionID: string): Promise<void> {
    log.debug("injectContinuation called", { sessionID })

    // Check for pending cancellation before proceeding
    if (hasPendingCancellation(sessionID)) {
      log.debug("Skipping continuation due to pending cancellation", { sessionID })
      return
    }

    // Clear any pending countdown
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }

    const todos = await fetchTodos(sessionID)
    const incompleteCount = getIncompleteCount(todos)

    log.debug("Checking todos for continuation", {
      sessionID,
      totalTodos: todos.length,
      incompleteCount,
    })

    // Check for active goals
    let activeGoal: Goal | null = null
    let hasActiveGoal = false
    let hasPendingValidation = false
    if (goalManagement) {
      activeGoal = await goalManagement.getGoal(sessionID)
      hasActiveGoal = activeGoal !== null && activeGoal.status === "active"
      hasPendingValidation = await goalManagement.checkPendingValidation(sessionID)
    }

    // Continue if there are incomplete todos OR active goals OR pending validation
    if (incompleteCount === 0 && !hasActiveGoal && !hasPendingValidation) {
      return
    }

    // Handle pending validation first
    if (hasPendingValidation && activeGoal) {
      const validationPrompt = `## Goal Validation Required

The goal "${activeGoal.title}" has been marked as completed.

**Please review and verify the done condition:**

**Done Condition:** ${activeGoal.done_condition}
${activeGoal.description ? `**Description:** ${activeGoal.description}` : ""}

**Review Checklist:**
- ✅ Verify the done condition is satisfied
- ✅ Confirm the work meets requirements
- ✅ Ensure the goal is truly complete

**Your task:**
Call goal_validate() to validate this goal.

If not yet complete, you can:
- Set a new goal with goal_set()
- Continue working on this goal`

      try {
        await promptWithContext({
          sessionID,
          text: validationPrompt,
          directory: ctx.directory,
        })
        
        // Clear the pending validation flag after injecting
        await goalManagement?.clearPendingValidation(sessionID)
      } catch (error) {
        log.error(`Failed to inject validation prompt for session ${sessionID}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
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

    // Get agent/model with polling
    let agentModel: {
      agent?: string | undefined
      model?: string | { providerID: string; modelID: string } | undefined
    } | null = null
    let attempts = 0
    const maxAttempts = 10

    while (!agentModel || (!agentModel.agent && !agentModel.model && attempts < maxAttempts)) {
      if (attempts > 0) {
        const delay = attempts > 5 ? 50 : 10
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      agentModel = await getAgentModel(sessionID)

      if (agentModel && (agentModel.agent || agentModel.model)) {
        break
      }

      attempts++
      log.debug("Polling for agent/model", {
        sessionID,
        attempt: attempts,
        maxAttempts,
        hasAgent: !!agentModel?.agent,
        hasModel: !!agentModel?.model,
      })
    }

    const continuationAgent = agentModel?.agent
    const continuationModel = agentModel?.model as
      | { providerID: string; modelID: string }
      | undefined

    log.debug("Injecting continuation prompt", {
      sessionID,
      agent: continuationAgent,
      model: continuationModel,
      promptLength: prompt.length,
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

      log.debug("Continuation prompt injected successfully", { sessionID })
    } catch (error) {
      log.error(`Failed to inject continuation for session ${sessionID}`, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function scheduleContinuation(sessionID: string): Promise<void> {
    // Check for pending cancellation before scheduling
    if (hasPendingCancellation(sessionID)) {
      log.debug("Skipping continuation scheduling due to pending cancellation", { sessionID })
      return
    }

    // Clear any existing countdown
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    // Schedule new countdown
    const timeout = setTimeout(async () => {
      pendingCountdowns.delete(sessionID)
      // Double-check cancellation state when timer fires
      if (hasPendingCancellation(sessionID)) {
        log.debug("Timer fired but cancellation pending, skipping", { sessionID })
        return
      }
      try {
        log.debug("Countdown timer fired, injecting continuation", { sessionID })
        await injectContinuation(sessionID)
      } catch (error) {
        log.error(`Error in continuation timeout callback for session ${sessionID}`, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }, countdownSeconds * 1000)

    pendingCountdowns.set(sessionID, timeout)
    log.debug("Countdown timer scheduled", { sessionID, countdownSeconds })

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

    log.debug("Session idle - checking todos", {
      sessionID,
      totalTodos: todos.length,
      incompleteCount,
    })

    // Check for active goals
    let hasActiveGoal = false
    if (goalManagement) {
      const goal = await goalManagement.getGoal(sessionID)
      hasActiveGoal = goal !== null && goal.status === "active"
      log.debug("Session idle - checking goals", {
        sessionID,
        hasGoal: goal !== null,
        goalStatus: goal?.status,
        goalTitle: goal?.title,
      })
    }

    // Check for pending validation
    let hasPendingValidation = false
    if (goalManagement) {
      hasPendingValidation = await goalManagement.checkPendingValidation(sessionID)
    }

    // Continue if there are incomplete todos OR active goals OR pending validation
    if (incompleteCount === 0 && !hasActiveGoal && !hasPendingValidation) {
      return
    }

    scheduleContinuation(sessionID)
  }

  const handleSessionError = async (sessionID: string, event?: LoopEvent): Promise<void> => {
    // Clear any pending countdown
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }

    // Set error cooldown
    errorCooldowns.set(sessionID, Date.now())

    // Check for interruption
    const error = event?.properties?.error
    const { isInterruption } = checkInterruption(error)

    if (isInterruption) {
      log.debug("Session interruption detected", { sessionID })

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

  const handleUserMessage = async (sessionID: string, event?: LoopEvent): Promise<void> => {
    log.debug("handleUserMessage called", { sessionID, eventType: event?.type })

    // Extract message info first
    const info = event?.properties?.info
    const messageID = (info as { id?: string })?.id
    const role = (info as { role?: string })?.role
    const summary = (info as { summary?: unknown })?.summary
    const messageContent =
      (info as { content?: string; text?: string; message?: string })?.content ||
      (info as { content?: string; text?: string; message?: string })?.text ||
      (info as { content?: string; text?: string; message?: string })?.message
    const messageTimestamp = (info as { timestamp?: number; createdAt?: number })?.timestamp ||
      (info as { timestamp?: number; createdAt?: number })?.createdAt ||
      Date.now()

    // Check for interruption in message (handle error case first)
    const messageError = (info as { error?: unknown })?.error
    if (messageError) {
      const { isInterruption } = checkInterruption(messageError)
      if (isInterruption) {
        cancelCountdownAtomic(sessionID, "message_error_interruption")
        log.debug("Message interruption detected", { sessionID })
        return // Exit early on interruption
      }
    }

    // Deduplication: Check message ID and timestamp
    if (messageID) {
      const lastProcessed = lastProcessedMessageID.get(sessionID)
      const lastTimestamp = messageTimestamps.get(sessionID) ?? 0
      
      // Skip if same message ID or if timestamp is older/same as last processed
      if (lastProcessed === messageID) {
        log.debug("Skipping duplicate message", { sessionID, messageID })
        return
      }
      
      // Additional timestamp check for race condition prevention
      if (messageTimestamp <= lastTimestamp && lastProcessed) {
        log.debug("Skipping out-of-order message", { 
          sessionID, 
          messageID, 
          messageTimestamp, 
          lastTimestamp 
        })
        return
      }
      
      // Update tracking atomically
      lastProcessedMessageID.set(sessionID, messageID)
      messageTimestamps.set(sessionID, messageTimestamp)
    }

    // Handle user messages (not summaries)
    if (role === "user" && !summary) {
      // Check if message indicates explicit cancellation first
      const isCancellation = messageContent && checkMessageCancellation(messageContent)
      
      if (isCancellation) {
        // Explicit cancellation: cancel countdown and set cooldown atomically
        const wasCancelled = cancelCountdownAtomic(sessionID, "user_cancellation_message")
        
        log.debug("User cancellation detected in message", {
          sessionID,
          messageID,
          content: messageContent.substring(0, 100),
          hadPendingCountdown: wasCancelled,
        })

        try {
          await ctx.client.tui.showToast({
            body: {
              title: "Task Cancelled",
              message: "Continuation cancelled based on your message",
              variant: "warning",
              duration: 2000,
            },
          })
        } catch {
          // Ignore toast errors
        }
      } else {
        // Non-cancellation user message: cancel any pending countdown but clear cancellation state
        // This allows future continuations after user interacts
        const existingTimeout = pendingCountdowns.get(sessionID)
        if (existingTimeout) {
          clearTimeout(existingTimeout)
          pendingCountdowns.delete(sessionID)
          log.debug("New user message cancelled pending countdown", { sessionID, messageID })
        }
        
        // Clear previous error cooldown and cancellation state on new user input
        // This resets the session to a clean state for future continuations
        errorCooldowns.delete(sessionID)
        clearCancellationState(sessionID)
      }
    }

    // Capture agent/model from user message
    if (event?.properties?.info) {
      const msgInfo = event.properties.info
      const messageAgent = (msgInfo as { agent?: string }).agent
      const messageModel = (msgInfo as { model?: string | ModelSpec }).model

      if (messageAgent || messageModel) {
        log.debug("Captured agent/model from message", {
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
    pendingCancellations.delete(sessionID)
    messageTimestamps.delete(sessionID)

    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }
  }

  const handleSessionActive = async (sessionID: string): Promise<void> => {
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
      log.debug("Session became active, cancelled pending countdown", { sessionID })
    }
  }

  const handleSessionBusy = async (sessionID: string): Promise<void> => {
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
      log.debug("Session became busy, cancelled pending countdown", { sessionID })
    }
  }

  const handleSessionCancelled = async (sessionID: string): Promise<void> => {
    // Clear any pending countdown
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }

    // Set error cooldown to prevent immediate continuation
    errorCooldowns.set(sessionID, Date.now())

    log.debug("Session cancellation detected, stopping continuation", { sessionID })

    try {
      await ctx.client.tui.showToast({
        body: {
          title: "Session Cancelled",
          message: "Task continuation cancelled by user",
          variant: "warning",
          duration: 2000,
        },
      })
    } catch {
      // Ignore toast errors
    }
  }

  const handleSessionStatus = async (sessionID: string, event?: LoopEvent): Promise<void> => {
    const status = event?.properties?.status
    if (
      status &&
      typeof status === "object" &&
      "type" in status &&
      (status as { type?: string }).type === "idle"
    ) {
      const lastError = errorCooldowns.get(sessionID) ?? 0
      const recentError = Date.now() - lastError < 5000

      if (recentError) {
        log.debug("Session returned to idle after recent error, skipping continuation", {
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
      case "session.cancelled":
        await handleSessionCancelled(sessionID)
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
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }

    errorCooldowns.delete(sessionID)
    recoveringSessions.delete(sessionID)
    pendingCancellations.delete(sessionID)
    messageTimestamps.delete(sessionID)
  }

  const cleanup = async (): Promise<void> => {
    for (const timeout of pendingCountdowns.values()) {
      clearTimeout(timeout)
    }
    pendingCountdowns.clear()
    recoveringSessions.clear()
    errorCooldowns.clear()
    sessionAgentModel.clear()
    lastProcessedMessageID.clear()
    pendingCancellations.clear()
    messageTimestamps.clear()
    log.debug("Task continuation cleanup completed")
  }

  return {
    handler,
    markRecovering,
    markRecoveryComplete,
    cancel,
    cleanup,
  }
}

