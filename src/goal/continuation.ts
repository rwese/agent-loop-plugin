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

// ============================================================================
// STATE MACHINE TYPES
// ============================================================================

/**
 * Continuation state machine states
 */
type ContinuationStateType =
  | "idle"           // No continuation scheduled
  | "scheduled"      // Countdown timer scheduled
  | "injecting"      // Currently injecting prompt
  | "cancelled"      // User cancelled, blocking continuation
  | "recovering"     // Session in recovery mode
  | "cooldown"       // In error cooldown period

/**
 * Unified state container for a session's continuation state
 */
interface SessionContinuationState {
  /** Current state machine state */
  state: ContinuationStateType
  /** Active countdown timer (if scheduled) */
  timeout: ReturnType<typeof setTimeout> | null
  /** Timestamp when cooldown started */
  cooldownStart: number | null
  /** Last processed message ID for deduplication */
  lastMessageID: string | null
  /** Last message timestamp for ordering */
  lastMessageTimestamp: number
  /** Captured agent/model config for the session */
  agentModel: { agent?: string; model?: string | ModelSpec } | null
  /** State change timestamp for debugging */
  stateChangedAt: number
}

/**
 * Manages continuation state machine for all sessions
 * Provides atomic state transitions with validation
 */
class ContinuationStateManager {
  private sessions = new Map<string, SessionContinuationState>()
  private readonly errorCooldownMs: number

  constructor(errorCooldownMs: number) {
    this.errorCooldownMs = errorCooldownMs
  }

  /**
   * Get or create session state
   */
  private getSession(sessionID: string): SessionContinuationState {
    let session = this.sessions.get(sessionID)
    if (!session) {
      session = {
        state: "idle",
        timeout: null,
        cooldownStart: null,
        lastMessageID: null,
        lastMessageTimestamp: 0,
        agentModel: null,
        stateChangedAt: Date.now(),
      }
      this.sessions.set(sessionID, session)
    }
    return session
  }

  /**
   * Atomically check if transition is valid
   */
  canTransition(sessionID: string, from: ContinuationStateType[], _to: ContinuationStateType): boolean {
    const session = this.getSession(sessionID)
    return from.includes(session.state)
  }

  /**
   * Atomic transition with validation - returns success
   */
  transition(sessionID: string, from: ContinuationStateType[], to: ContinuationStateType): boolean {
    const session = this.getSession(sessionID)
    
    if (!from.includes(session.state)) {
      log.warn("Invalid state transition attempted", {
        sessionID,
        currentState: session.state,
        attemptedState: to,
        allowedFrom: from,
      })
      return false
    }

    session.state = to
    session.stateChangedAt = Date.now()
    
    log.debug("State transition successful", {
      sessionID,
      from: from,
      to,
    })
    
    return true
  }

  /**
   * Schedule a countdown - returns true if scheduled
   */
  scheduleCountdown(sessionID: string, callback: () => Promise<void>, delayMs: number): boolean {
    const session = this.getSession(sessionID)
    
    // Clear existing timeout
    if (session.timeout) {
      clearTimeout(session.timeout)
      session.timeout = null
    }

    // Check if we can transition to scheduled
    if (!this.canTransition(sessionID, ["idle", "cooldown"], "scheduled")) {
      log.debug("scheduleCountdown: cannot transition to scheduled", {
        sessionID,
        currentState: session.state,
      })
      return false
    }

    const timeout = setTimeout(async () => {
      // Use the session's state at timeout firing time
      const currentSession = this.sessions.get(sessionID)
      if (!currentSession) return

      // Check if still in scheduled state
      if (currentSession.state !== "scheduled") {
        log.debug("Timer fired but no longer in scheduled state", {
          sessionID,
          state: currentSession.state,
        })
        return
      }

      // Transition to injecting and execute callback
      currentSession.state = "injecting"
      currentSession.stateChangedAt = Date.now()
      currentSession.timeout = null

      try {
        await callback()
      } catch (error) {
        log.error("Error in countdown callback", {
          sessionID,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }, delayMs)

    session.timeout = timeout
    
    if (!this.transition(sessionID, ["idle", "cooldown"], "scheduled")) {
      // Rollback timeout creation if transition failed
      clearTimeout(timeout)
      session.timeout = null
      return false
    }

    return true
  }

  /**
   * Cancel any pending countdown and transition to cancelled
   */
  cancelCountdown(sessionID: string, reason: string): boolean {
    const session = this.getSession(sessionID)
    
    // Clear timeout if exists
    if (session.timeout) {
      clearTimeout(session.timeout)
      session.timeout = null
    }

    // Set cooldown start timestamp
    session.cooldownStart = Date.now()

    // Try to transition to cancelled
    const transitioned = this.transition(sessionID, ["idle", "scheduled", "injecting", "cooldown"], "cancelled")
    
    if (transitioned) {
      log.debug("Countdown cancelled", { sessionID, reason })
    }
    
    return transitioned
  }

  /**
   * Clear countdown timer (on session active/busy)
   */
  clearCountdown(sessionID: string): void {
    const session = this.getSession(sessionID)
    
    if (session.timeout) {
      clearTimeout(session.timeout)
      session.timeout = null
    }

    // Transition from scheduled back to idle
    if (session.state === "scheduled") {
      session.state = "idle"
      session.stateChangedAt = Date.now()
    }
  }

  /**
   * Check if continuation should be blocked
   */
  isBlocked(sessionID: string): boolean {
    const session = this.getSession(sessionID)
    return session.state === "cancelled"
  }

  /**
   * Check if in error cooldown
   */
  isInCooldown(sessionID: string): boolean {
    const session = this.getSession(sessionID)
    
    if (session.state === "cooldown" && session.cooldownStart !== null) {
      const elapsed = Date.now() - session.cooldownStart
      if (elapsed < this.errorCooldownMs) {
        return true
      }
      // Cooldown period has passed, transition back to idle
      session.state = "idle"
      session.stateChangedAt = Date.now()
      session.cooldownStart = null
    }
    
    return false
  }

  /**
   * Start error cooldown
   */
  startCooldown(sessionID: string): void {
    const session = this.getSession(sessionID)
    
    // Clear any existing timeout
    if (session.timeout) {
      clearTimeout(session.timeout)
      session.timeout = null
    }

    session.cooldownStart = Date.now()
    session.state = "cooldown"
    session.stateChangedAt = Date.now()
  }

  /**
   * Clear cooldown (on new user message)
   */
  clearCooldown(sessionID: string): void {
    const session = this.getSession(sessionID)
    
    session.cooldownStart = null
    
    if (session.state === "cooldown") {
      session.state = "idle"
      session.stateChangedAt = Date.now()
    }
  }

  /**
   * Update message tracking - returns true if new message
   */
  trackMessage(sessionID: string, messageID: string, timestamp: number): boolean {
    const session = this.getSession(sessionID)
    
    // Skip if same message ID
    if (session.lastMessageID === messageID) {
      return false
    }
    
    // Skip if timestamp is older than last processed
    if (timestamp <= session.lastMessageTimestamp && session.lastMessageID !== null) {
      return false
    }

    session.lastMessageID = messageID
    session.lastMessageTimestamp = timestamp
    return true
  }

  /**
   * Update agent/model config
   */
  setAgentModel(sessionID: string, config: { agent?: string; model?: string | ModelSpec }): void {
    const session = this.getSession(sessionID)
    session.agentModel = config
  }

  /**
   * Get agent/model config
   */
  getAgentModel(sessionID: string): { agent?: string; model?: string | ModelSpec } | null {
    const session = this.getSession(sessionID)
    return session.agentModel
  }

  /**
   * Mark session as recovering
   */
  setRecovering(sessionID: string, recovering: boolean): void {
    const session = this.getSession(sessionID)
    
    if (recovering) {
      // Clear any existing timeout
      if (session.timeout) {
        clearTimeout(session.timeout)
        session.timeout = null
      }
      
      session.state = "recovering"
      session.stateChangedAt = Date.now()
    } else {
      // Transition back to idle when recovery completes
      session.state = "idle"
      session.stateChangedAt = Date.now()
    }
  }

  /**
   * Check if session is recovering
   */
  isRecovering(sessionID: string): boolean {
    const session = this.getSession(sessionID)
    return session.state === "recovering"
  }

  /**
   * Reset session to idle state (clears cancellation)
   */
  resetToIdle(sessionID: string): void {
    const session = this.getSession(sessionID)
    
    // Only reset from cancelled state
    if (session.state === "cancelled") {
      session.state = "idle"
      session.stateChangedAt = Date.now()
      session.cooldownStart = null
    }
  }

  /**
   * Delete all state for a session
   */
  deleteSession(sessionID: string): void {
    const session = this.sessions.get(sessionID)
    if (session) {
      if (session.timeout) {
        clearTimeout(session.timeout)
      }
      this.sessions.delete(sessionID)
    }
  }

  /**
   * Cleanup all sessions
   */
  cleanup(): void {
    for (const session of this.sessions.values()) {
      if (session.timeout) {
        clearTimeout(session.timeout)
      }
    }
    this.sessions.clear()
  }

  /**
   * Get current state for debugging
   */
  getState(sessionID: string): ContinuationStateType {
    return this.getSession(sessionID).state
  }
}

// ============================================================================
// LEGACY HELPER FUNCTIONS
// ============================================================================

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

// ============================================================================
// MAIN IMPLEMENTATION
// ============================================================================

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

  // Create state manager instance
  const stateManager = new ContinuationStateManager(errorCooldownMs)

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

  async function getAgentModel(sessionID: string): Promise<{
    agent?: string | undefined
    model?: string | { providerID: string; modelID: string } | undefined
  }> {
    const tracked = stateManager.getAgentModel(sessionID)
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

  async function injectContinuation(sessionID: string): Promise<void> {
    log.debug("injectContinuation called", { sessionID })

    // Check for pending cancellation before proceeding
    if (stateManager.isBlocked(sessionID)) {
      log.debug("Skipping continuation due to pending cancellation", { sessionID })
      return
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
    if (stateManager.isBlocked(sessionID)) {
      log.debug("Skipping continuation scheduling due to pending cancellation", { sessionID })
      return
    }

    // Clear any existing countdown via state manager
    stateManager.clearCountdown(sessionID)

    // Schedule new countdown
    const scheduled = stateManager.scheduleCountdown(
      sessionID,
      async () => {
        await injectContinuation(sessionID)
      },
      countdownSeconds * 1000
    )

    if (scheduled) {
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
  }

  const handleSessionIdle = async (sessionID: string): Promise<void> => {
    // Check if session is recovering
    if (stateManager.isRecovering(sessionID)) {
      return
    }

    // Check error cooldown
    if (stateManager.isInCooldown(sessionID)) {
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
    // Clear any pending countdown via state manager
    stateManager.clearCountdown(sessionID)

    // Set error cooldown
    stateManager.startCooldown(sessionID)

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
        stateManager.cancelCountdown(sessionID, "message_error_interruption")
        log.debug("Message interruption detected", { sessionID })
        return // Exit early on interruption
      }
    }

    // Deduplication: Check message ID and timestamp via state manager
    if (messageID && messageTimestamp) {
      const isNewMessage = stateManager.trackMessage(sessionID, messageID, messageTimestamp)
      
      if (!isNewMessage) {
        log.debug("Skipping duplicate or out-of-order message", { sessionID, messageID })
        return
      }
    }

    // Handle user messages (not summaries)
    if (role === "user" && !summary) {
      // Check if message indicates explicit cancellation first
      const isCancellation = messageContent && checkMessageCancellation(messageContent)
      
      if (isCancellation) {
        // Explicit cancellation: cancel countdown and set cooldown
        const wasCancelled = stateManager.cancelCountdown(sessionID, "user_cancellation_message")
        
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
        // Non-cancellation user message: clear any pending countdown via state manager
        stateManager.clearCountdown(sessionID)
        
        // Clear previous error cooldown and cancellation state on new user input
        // This resets the session to a clean state for future continuations
        stateManager.clearCooldown(sessionID)
        stateManager.resetToIdle(sessionID)
        
        log.debug("New user message cancelled pending countdown and cleared state", {
          sessionID,
          messageID,
        })
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
        stateManager.setAgentModel(sessionID, { agent: messageAgent, model: messageModel })
      }
    }
  }

  const handleSessionDeleted = async (sessionID: string): Promise<void> => {
    // Cleanup session state via state manager
    stateManager.deleteSession(sessionID)
    log.debug("Session state cleaned up", { sessionID })
  }

  const handleSessionActive = async (sessionID: string): Promise<void> => {
    const wasScheduled = stateManager.getState(sessionID) === "scheduled"
    stateManager.clearCountdown(sessionID)
    
    if (wasScheduled) {
      log.debug("Session became active, cancelled pending countdown", { sessionID })
    }
  }

  const handleSessionBusy = async (sessionID: string): Promise<void> => {
    const wasScheduled = stateManager.getState(sessionID) === "scheduled"
    stateManager.clearCountdown(sessionID)
    
    if (wasScheduled) {
      log.debug("Session became busy, cancelled pending countdown", { sessionID })
    }
  }

  const handleSessionCancelled = async (sessionID: string): Promise<void> => {
    // Clear any pending countdown
    stateManager.clearCountdown(sessionID)

    // Set error cooldown to prevent immediate continuation
    stateManager.startCooldown(sessionID)

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
      // Check if in cooldown
      const inCooldown = stateManager.isInCooldown(sessionID)

      if (inCooldown) {
        log.debug("Session returned to idle after recent error, skipping continuation", {
          sessionID,
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
    stateManager.setRecovering(sessionID, true)
  }

  const markRecoveryComplete = (sessionID: string): void => {
    stateManager.setRecovering(sessionID, false)
  }

  const cancel = (sessionID: string): void => {
    // Cancel countdown and set cooldown
    stateManager.cancelCountdown(sessionID, "cancel_method_called")
    // Also clear recovering state
    stateManager.setRecovering(sessionID, false)
  }

  const cleanup = async (): Promise<void> => {
    stateManager.cleanup()
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
