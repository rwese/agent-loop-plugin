/**
 * Iteration Loop with State Machine Pattern
 *
 * A clean state machine implementation for managing iteration loop states
 * and transitions.
 *
 * States: idle -> starting -> active -> evaluating -> (continuing | completed | cancelled | error)
 */

import { existsSync, readFileSync } from "node:fs"
import type {
  PluginContext,
  IterationLoopState,
  IterationLoopOptions,
  IterationContinueCallbackInfo,
  LoopEvent,
  Logger,
  CompleteLoopResult,
  AdvisorEvaluationResult,
  CompletionEvaluatorInfo,
} from "./types.js"
import {
  createLogger,
  readLoopState,
  writeLoopState,
  clearLoopState,
  incrementIteration,
  sendIgnoredMessage,
  writeOutput,
  generateCodename,
} from "./utils.js"
import { parseIterationLoopTag, buildIterationStartPrompt } from "./prompt-parser.js"

/** Configuration constants for iteration loop behavior */
const CONSTANTS = {
  DEFAULT_MAX_ITERATIONS: 100,
  ITERATION_DEBOUNCE_MS: 3000,
  RECOVERY_TIMEOUT_MS: 5000,
} as const

/** Continuation prompt template for Advisor-based evaluation */
const ADVISOR_CONTINUATION_PROMPT = `[ITERATION LOOP - ITERATION {{ITERATION}}/{{MAX}}]

You have completed {{ITERATION_MINUS_ONE}} iteration(s).

{{ADVISOR_FEEDBACK}}

Please address the issues above and continue working on the task. Once all requirements are met, the Advisor will signal completion.

{{PROMPT}}

{{ADDITIONAL_CONTEXT}}`

/** Per-session state for tracking recovery and iteration locks */
interface SessionState {
  isRecovering?: boolean
  iterationInProgress?: boolean
  lastIterationTime?: number
}

// ============================================================================
// State Machine Types
// ============================================================================

/** All possible states in the iteration loop state machine */
type IterationState =
  | { type: "idle" }
  | { type: "starting"; sessionID: string; prompt: string; maxIterations: number }
  | {
      type: "active"
      sessionID: string
      prompt: string
      iteration: number
      maxIterations: number
      codename: string
    }
  | {
      type: "evaluating"
      sessionID: string
      prompt: string
      iteration: number
      maxIterations: number
    }
  | {
      type: "continuing"
      sessionID: string
      prompt: string
      iteration: number
      maxIterations: number
      codename: string
      feedback: string
      missingItems?: string[]
    }
  | { type: "completed"; sessionID: string; iterations: number; feedback: string }
  | { type: "cancelled"; sessionID: string; iterations: number }
  | { type: "error"; sessionID: string; error: string; iterations: number }

/** Events that trigger state transitions */
type IterationEvent =
  | { type: "start"; sessionID: string; prompt: string; maxIterations?: number }
  | { type: "evaluate"; transcript: string }
  | { type: "complete"; feedback: string; confidence?: number }
  | { type: "continue"; feedback: string; missingItems?: string[] }
  | { type: "cancel" }
  | { type: "max_reached" }
  | { type: "error"; error: string }
  | { type: "session_idle"; transcript?: string }
  | { type: "session_deleted" }
  | { type: "session_error" }
  | { type: "message_updated"; role: string }

/** Actions to perform during state transitions */
type StateAction =
  | { type: "write_state"; state: IterationLoopState }
  | { type: "clear_state" }
  | { type: "increment_iteration" }
  | { type: "send_prompt"; prompt: string }
  | {
      type: "show_toast"
      title: string
      message: string
      variant: "info" | "success" | "warning" | "error"
    }
  | { type: "send_status"; message: string }
  | { type: "call_evaluator"; info: CompletionEvaluatorInfo }
  | { type: "complete_loop"; feedback: string }

// ============================================================================
// Helper Functions
// ============================================================================

/** Get session state from state object */
function getSessionID(state: IterationState): string | undefined {
  switch (state.type) {
    case "starting":
    case "active":
    case "evaluating":
    case "continuing":
    case "completed":
    case "cancelled":
    case "error":
      return state.sessionID
    default:
      return undefined
  }
}

function getIteration(state: IterationState): number | undefined {
  switch (state.type) {
    case "active":
    case "evaluating":
    case "continuing":
      return state.iteration
    case "completed":
    case "cancelled":
    case "error":
      return state.iterations
    default:
      return undefined
  }
}

function getMaxIterations(state: IterationState): number | undefined {
  switch (state.type) {
    case "starting":
    case "active":
    case "evaluating":
    case "continuing":
      return state.maxIterations
    default:
      return undefined
  }
}

function getPrompt(state: IterationState): string | undefined {
  switch (state.type) {
    case "starting":
    case "active":
    case "evaluating":
    case "continuing":
      return state.prompt
    default:
      return undefined
  }
}

// ============================================================================
// State Machine Implementation
// ============================================================================

class IterationStateMachine {
  private state: IterationState = { type: "idle" }
  private lastActionTime: number = 0
  private logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
  }

  /** Get current state */
  getState(): IterationState {
    return this.state
  }

  /** Restore state from persisted data */
  restoreState(stateData: {
    sessionID: string
    prompt: string
    iteration: number
    maxIterations: number
    codename: string
  }): void {
    this.state = {
      type: "active",
      sessionID: stateData.sessionID,
      prompt: stateData.prompt,
      iteration: stateData.iteration,
      maxIterations: stateData.maxIterations,
      codename: stateData.codename,
    }
  }

  /** Process an event and return new state and actions */
  process(event: IterationEvent): { newState: IterationState; actions: StateAction[] } {
    const oldState = this.state
    let newState: IterationState
    const actions: StateAction[] = []

    switch (oldState.type) {
      case "idle":
        newState = this.handleIdle(event, actions)
        break
      case "starting":
        newState = this.handleStarting(event, actions, oldState)
        break
      case "active":
        newState = this.handleActive(event, actions, oldState)
        break
      case "evaluating":
        newState = this.handleEvaluating(event, actions, oldState)
        break
      case "continuing":
        newState = this.handleContinuing(event, actions, oldState)
        break
      case "completed":
      case "cancelled":
      case "error":
        newState = oldState
        break
      default:
        newState = oldState
    }

    this.state = newState
    return { newState, actions }
  }

  // --------------------------------------------------------------------------
  // State Handlers
  // --------------------------------------------------------------------------

  private handleIdle(event: IterationEvent, actions: StateAction[]): IterationState {
    // Handle session deletion in idle state
    if (event.type === "session_deleted") {
      actions.push({ type: "clear_state" })
      return { type: "idle" }
    }

    if (event.type === "start") {
      const codename = generateCodename()
      const maxIterations = event.maxIterations ?? CONSTANTS.DEFAULT_MAX_ITERATIONS

      actions.push({
        type: "write_state",
        state: {
          active: true,
          iteration: 1,
          max_iterations: maxIterations,
          completion_marker: codename,
          started_at: new Date().toISOString(),
          prompt: event.prompt,
          session_id: event.sessionID,
        },
      })

      actions.push({
        type: "send_status",
        message: `🔄 [startLoop] Iteration Loop: Started (1/${maxIterations}) - Advisor will evaluate completion`,
      })

      return {
        type: "starting",
        sessionID: event.sessionID,
        prompt: event.prompt,
        maxIterations,
      }
    }

    return { type: "idle" }
  }

  private handleStarting(
    event: IterationEvent,
    actions: StateAction[],
    state: { type: "starting"; sessionID: string; prompt: string; maxIterations: number }
  ): IterationState {
    // Handle session deletion
    if (event.type === "session_deleted") {
      actions.push({ type: "clear_state" })
      return { type: "idle" }
    }

    // Handle direct completion from starting state
    if (event.type === "complete") {
      actions.push({ type: "clear_state" })
      actions.push({
        type: "show_toast",
        title: "Iteration Loop Complete!",
        message: `Task completed: ${event.feedback}`,
        variant: "success",
      })

      return {
        type: "completed",
        sessionID: state.sessionID,
        iterations: 1,
        feedback: event.feedback,
      }
    }

    if (event.type === "session_idle") {
      actions.push({
        type: "send_status",
        message: `🚀 [starting] Loop initialized, now evaluating...`,
      })

      return {
        type: "active",
        sessionID: state.sessionID,
        prompt: state.prompt,
        iteration: 1,
        maxIterations: state.maxIterations,
        codename: generateCodename(),
      }
    }

    return state
  }

  private handleActive(
    event: IterationEvent,
    actions: StateAction[],
    state: {
      type: "active"
      sessionID: string
      prompt: string
      iteration: number
      maxIterations: number
      codename: string
    }
  ): IterationState {
    if (event.type === "session_idle") {
      actions.push({
        type: "call_evaluator",
        info: {
          sessionID: state.sessionID,
          iteration: state.iteration,
          maxIterations: state.maxIterations,
          prompt: state.prompt,
          transcript: event.transcript || "",
          complete: () => ({ success: true, iterations: state.iteration, message: "Completed" }),
          continueWithFeedback: async () => {},
        },
      })

      return {
        type: "evaluating",
        sessionID: state.sessionID,
        prompt: state.prompt,
        iteration: state.iteration,
        maxIterations: state.maxIterations,
      }
    }

    // Handle session deletion
    if (event.type === "session_deleted") {
      actions.push({ type: "clear_state" })
      actions.push({
        type: "show_toast",
        title: "Iteration Loop Cleared",
        message: `Loop cleared due to session deletion`,
        variant: "info",
      })
      return { type: "idle" }
    }

    // Handle direct completion from active state
    if (event.type === "complete") {
      actions.push({ type: "clear_state" })
      actions.push({
        type: "show_toast",
        title: "Iteration Loop Complete!",
        message: `Task completed after ${state.iteration} iteration(s): ${event.feedback}`,
        variant: "success",
      })
      actions.push({
        type: "send_status",
        message: `🎉 [completeLoop] Iteration Loop: Complete! Finished in ${state.iteration} iteration(s). Advisor: ${event.feedback}`,
      })

      return {
        type: "completed",
        sessionID: state.sessionID,
        iterations: state.iteration,
        feedback: event.feedback,
      }
    }

    if (event.type === "cancel") {
      actions.push({ type: "clear_state" })
      actions.push({
        type: "show_toast",
        title: "Iteration Loop Cancelled",
        message: `Loop cancelled at iteration ${state.iteration}/${state.maxIterations}`,
        variant: "warning",
      })
      actions.push({
        type: "send_status",
        message: `🛑 [cancelLoop] Iteration Loop: Cancelled at iteration ${state.iteration}/${state.maxIterations}`,
      })

      return {
        type: "cancelled",
        sessionID: state.sessionID,
        iterations: state.iteration,
      }
    }

    return state
  }

  private handleEvaluating(
    event: IterationEvent,
    actions: StateAction[],
    state: {
      type: "evaluating"
      sessionID: string
      prompt: string
      iteration: number
      maxIterations: number
    }
  ): IterationState {
    if (event.type === "complete") {
      actions.push({ type: "clear_state" })
      actions.push({
        type: "show_toast",
        title: "Iteration Loop Complete!",
        message: `Task completed after ${state.iteration} iteration(s): ${event.feedback}`,
        variant: "success",
      })
      actions.push({
        type: "send_status",
        message: `🎉 [evaluating] Iteration Loop: Complete! Finished in ${state.iteration} iteration(s). Advisor: ${event.feedback}`,
      })

      return {
        type: "completed",
        sessionID: state.sessionID,
        iterations: state.iteration,
        feedback: event.feedback,
      }
    }

    if (event.type === "continue") {
      const missingItemsText =
        event.missingItems && event.missingItems.length > 0
          ? `\n\nMissing items that need to be addressed:\n${event.missingItems.map((item) => `- ${item}`).join("\n")}`
          : ""

      const additionalContext = event.feedback
        ? `\n\nAdvisor Feedback:\n${event.feedback}${missingItemsText}`
        : missingItemsText

      const continuationPrompt = ADVISOR_CONTINUATION_PROMPT.replace(
        "{{ITERATION}}",
        String(state.iteration + 1)
      )
        .replace("{{MAX}}", String(state.maxIterations))
        .replace("{{ITERATION_MINUS_ONE}}", String(state.iteration))
        .replace("{{PROMPT}}", state.prompt)
        .replace("{{ADVISOR_FEEDBACK}}", event.feedback || "Please continue working on the task.")
        .replace("{{ADDITIONAL_CONTEXT}}", additionalContext)

      actions.push({ type: "increment_iteration" })
      actions.push({ type: "send_prompt", prompt: continuationPrompt })
      actions.push({
        type: "show_toast",
        title: "Iteration Loop",
        message: `Iteration ${state.iteration + 1}/${state.maxIterations} - Advisor feedback provided`,
        variant: "info",
      })
      actions.push({
        type: "send_status",
        message: `🔄 [continuing] Iteration Loop: Iteration ${state.iteration + 1}/${state.maxIterations} - Advisor feedback: ${event.feedback.substring(0, 100)}${event.feedback.length > 100 ? "..." : ""}`,
      })

      return {
        type: "continuing",
        sessionID: state.sessionID,
        prompt: state.prompt,
        iteration: state.iteration + 1,
        maxIterations: state.maxIterations,
        codename: generateCodename(),
        feedback: event.feedback,
        missingItems: event.missingItems,
      }
    }

    if (event.type === "max_reached") {
      actions.push({ type: "clear_state" })
      actions.push({
        type: "show_toast",
        title: "Iteration Loop Stopped",
        message: `Max iterations (${state.maxIterations}) reached without completion`,
        variant: "warning",
      })
      actions.push({
        type: "send_status",
        message: `⚠️ [evaluating] Iteration Loop: Stopped - Max iterations (${state.maxIterations}) reached`,
      })

      return {
        type: "cancelled",
        sessionID: state.sessionID,
        iterations: state.iteration,
      }
    }

    // Handle session deletion
    if (event.type === "session_deleted") {
      actions.push({ type: "clear_state" })
      actions.push({
        type: "show_toast",
        title: "Iteration Loop Cleared",
        message: `Loop cleared due to session deletion`,
        variant: "info",
      })
      return { type: "idle" }
    }

    if (event.type === "error") {
      actions.push({ type: "clear_state" })
      actions.push({
        type: "show_toast",
        title: "Iteration Loop Error",
        message: `Error during evaluation: ${event.error}`,
        variant: "error",
      })

      return {
        type: "error",
        sessionID: state.sessionID,
        error: event.error,
        iterations: state.iteration,
      }
    }

    return state
  }

  private handleContinuing(
    event: IterationEvent,
    actions: StateAction[],
    state: {
      type: "continuing"
      sessionID: string
      prompt: string
      iteration: number
      maxIterations: number
      codename: string
      feedback: string
      missingItems?: string[]
    }
  ): IterationState {
    if (event.type === "session_idle") {
      actions.push({
        type: "call_evaluator",
        info: {
          sessionID: state.sessionID,
          iteration: state.iteration,
          maxIterations: state.maxIterations,
          prompt: state.prompt,
          transcript: event.transcript || "",
          complete: () => ({ success: true, iterations: state.iteration, message: "Completed" }),
          continueWithFeedback: async () => {},
        },
      })

      return {
        type: "evaluating",
        sessionID: state.sessionID,
        prompt: state.prompt,
        iteration: state.iteration,
        maxIterations: state.maxIterations,
      }
    }

    // Handle session deletion
    if (event.type === "session_deleted") {
      actions.push({ type: "clear_state" })
      actions.push({
        type: "show_toast",
        title: "Iteration Loop Cleared",
        message: `Loop cleared due to session deletion`,
        variant: "info",
      })
      return { type: "idle" }
    }

    // Handle direct completion from continuing state
    if (event.type === "complete") {
      actions.push({ type: "clear_state" })
      actions.push({
        type: "show_toast",
        title: "Iteration Loop Complete!",
        message: `Task completed after ${state.iteration} iteration(s): ${event.feedback}`,
        variant: "success",
      })
      actions.push({
        type: "send_status",
        message: `🎉 [completeLoop] Iteration Loop: Complete! Finished in ${state.iteration} iteration(s). Advisor: ${event.feedback}`,
      })

      return {
        type: "completed",
        sessionID: state.sessionID,
        iterations: state.iteration,
        feedback: event.feedback,
      }
    }

    if (event.type === "cancel") {
      actions.push({ type: "clear_state" })
      actions.push({
        type: "show_toast",
        title: "Iteration Loop Cancelled",
        message: `Loop cancelled at iteration ${state.iteration}/${state.maxIterations}`,
        variant: "warning",
      })

      return {
        type: "cancelled",
        sessionID: state.sessionID,
        iterations: state.iteration,
      }
    }

    return state
  }
}

// ============================================================================
// Main Iteration Loop Implementation
// ============================================================================

/** Result of processing a prompt for iteration loop tags */
export interface ProcessPromptResult {
  shouldIntercept: boolean
  modifiedPrompt: string
}

/** Public interface for the Iteration Loop */
export interface IterationLoop {
  handler: (input: { event: LoopEvent }) => Promise<void>
  startLoop: (
    sessionID: string,
    prompt: string,
    options?: { maxIterations?: number }
  ) => Promise<boolean>
  cancelLoop: (sessionID: string) => boolean
  completeLoop: (sessionID: string, summary?: string) => CompleteLoopResult
  getState: () => IterationLoopState | null
  processPrompt: (sessionID: string, prompt: string) => Promise<ProcessPromptResult>
}

export function createIterationLoop(
  ctx: PluginContext,
  options: IterationLoopOptions = {}
): IterationLoop {
  const {
    defaultMaxIterations = CONSTANTS.DEFAULT_MAX_ITERATIONS,
    stateFilePath,
    logger: customLogger,
    logLevel = "info",
    agent,
    model,
    outputFilePath,
    onContinue,
    onEvaluator,
    getTranscript,
  } = options

  const logger: Logger = createLogger(customLogger, logLevel)
  const sessions = new Map<string, SessionState>()

  function logToFile(message: string, data?: Record<string, unknown>): void {
    if (outputFilePath) {
      writeOutput(ctx.directory, message, data, outputFilePath)
    }
  }

  function getSessionState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }

  // State machine instance
  const stateMachine = new IterationStateMachine(logger)

  // Initialize state machine from existing state file
  function initializeStateFromFile(): void {
    try {
      const existingState = readLoopState(ctx.directory, stateFilePath)
      if (existingState && existingState.active) {
        // Restore state based on stored information
        const maxIterations = existingState.max_iterations || CONSTANTS.DEFAULT_MAX_ITERATIONS
        const sessionID = existingState.session_id || ""

        // Restore state using the public method
        stateMachine.restoreState({
          sessionID,
          prompt: existingState.prompt,
          iteration: existingState.iteration,
          maxIterations,
          codename: existingState.completion_marker,
        })

        logger.info("Restored iteration loop state", {
          sessionID,
          iteration: existingState.iteration,
          maxIterations,
        })
      }
    } catch (err) {
      logger.warn("Failed to restore state from file", { error: String(err) })
    }
  }

  // Initialize state on creation
  initializeStateFromFile()

  async function executeActions(actions: StateAction[], sessionID: string): Promise<boolean> {
    let writeSuccess = true

    for (const action of actions) {
      switch (action.type) {
        case "write_state": {
          const success = writeLoopState(ctx.directory, action.state, stateFilePath)
          if (!success) {
            writeSuccess = false
          }
          break
        }

        case "clear_state":
          clearLoopState(ctx.directory, stateFilePath)
          break

        case "increment_iteration":
          incrementIteration(ctx.directory, stateFilePath)
          break

        case "send_prompt":
          try {
            await ctx.client.session.prompt({
              path: { id: sessionID },
              body: {
                agent,
                model,
                parts: [{ type: "text", text: action.prompt }],
              },
              query: { directory: ctx.directory },
            })
          } catch (err) {
            logger.error("Failed to send prompt", { sessionID, error: String(err) })
          }
          break

        case "show_toast":
          ctx.client.tui
            .showToast({
              body: {
                title: action.title,
                message: action.message,
                variant: action.variant,
                duration: 5000,
              },
            })
            .catch(() => {})
          break

        case "send_status":
          await sendIgnoredMessage(ctx.client, sessionID, action.message, logger, { agent, model })
          break

        case "call_evaluator":
          if (onEvaluator) {
            try {
              const evaluation = await onEvaluator(action.info)

              if (evaluation.isComplete) {
                const result = stateMachine.process({
                  type: "complete",
                  feedback: evaluation.feedback,
                  confidence: evaluation.confidence,
                })
                await executeActions(result.actions, sessionID)
              } else {
                const currentState = stateMachine.getState()
                if (
                  getIteration(currentState) !== undefined &&
                  getMaxIterations(currentState) !== undefined &&
                  getIteration(currentState)! >= getMaxIterations(currentState)!
                ) {
                  const result = stateMachine.process({ type: "max_reached" })
                  await executeActions(result.actions, sessionID)
                } else {
                  const result = stateMachine.process({
                    type: "continue",
                    feedback: evaluation.feedback,
                    missingItems: evaluation.missingItems,
                  })
                  await executeActions(result.actions, sessionID)
                }
              }
            } catch (evalError) {
              const errorStr = String(evalError)
              logger.error("Advisor evaluation failed", { sessionID, error: errorStr })
              const result = stateMachine.process({ type: "error", error: errorStr })
              await executeActions(result.actions, sessionID)
            }
          } else {
            logger.error("No onEvaluator callback provided", { sessionID })
          }
          break
      }
    }

    return writeSuccess
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  const startLoop = async (
    sessionID: string,
    prompt: string,
    loopOptions?: { maxIterations?: number }
  ): Promise<boolean> => {
    const maxIterations = loopOptions?.maxIterations ?? defaultMaxIterations

    const result = stateMachine.process({
      type: "start",
      sessionID,
      prompt,
      maxIterations,
    })

    const success = await executeActions(result.actions, sessionID)
    return success
  }

  const cancelLoop = (sessionID: string): boolean => {
    const state = stateMachine.getState()

    if (state.type === "idle") {
      return false
    }

    if (getSessionID(state) !== sessionID) {
      return false
    }

    const result = stateMachine.process({ type: "cancel" })
    executeActions(result.actions, sessionID)

    return true
  }

  const completeLoop = (sessionID: string, summary?: string): CompleteLoopResult => {
    const state = stateMachine.getState()

    if (state.type === "idle") {
      return {
        success: false,
        iterations: 0,
        message: "No active iteration loop to complete",
      }
    }

    if (getSessionID(state) !== sessionID) {
      return {
        success: false,
        iterations: 0,
        message: "Session ID does not match active loop",
      }
    }

    const iterations = getIteration(state) ?? 0

    const result = stateMachine.process({
      type: "complete",
      feedback: summary || "Manually completed",
    })

    for (const action of result.actions) {
      if (action.type === "clear_state") {
        clearLoopState(ctx.directory, stateFilePath)
      }
    }

    if (result.newState.type === "completed") {
      return {
        success: true,
        iterations,
        message: `Loop completed successfully after ${iterations} iteration(s)${summary ? ` - ${summary}` : ""}`,
      }
    }

    return {
      success: false,
      iterations,
      message: "Failed to complete loop",
    }
  }

  const getState = (): IterationLoopState | null => {
    return readLoopState(ctx.directory, stateFilePath)
  }

  const processPrompt = async (sessionID: string, prompt: string): Promise<ProcessPromptResult> => {
    const parsed = parseIterationLoopTag(prompt)

    if (!parsed.found || !parsed.task) {
      return { shouldIntercept: false, modifiedPrompt: prompt }
    }

    const maxIterations = parsed.maxIterations ?? defaultMaxIterations

    await startLoop(sessionID, parsed.task, { maxIterations })

    const state = getState()
    const marker = state?.completion_marker ?? "UNKNOWN"

    const modifiedPrompt = buildIterationStartPrompt(
      parsed.task,
      maxIterations,
      marker,
      parsed.cleanedPrompt
    )

    return { shouldIntercept: true, modifiedPrompt }
  }

  // ===========================================================================
  // Event Handler
  // ===========================================================================

  const handler = async ({ event }: { event: LoopEvent }): Promise<void> => {
    const props = event.properties
    const sessionID = props?.sessionID || props?.info?.sessionID

    const state = stateMachine.getState()

    // Handle session deletion first (before early return on idle)
    if (event.type === "session.deleted") {
      const deletedSessionID = props?.info?.id
      if (deletedSessionID && deletedSessionID === getSessionID(state)) {
        const result = stateMachine.process({ type: "session_deleted" })
        await executeActions(result.actions, deletedSessionID)
        return
      }
      // If no matching session, just return
      return
    }

    if (!sessionID) return

    const sessionState = getSessionState(sessionID)

    if (state.type === "idle") return

    // Handle session error
    if (event.type === "session.error") {
      const result = stateMachine.process({ type: "session_error" })
      await executeActions(result.actions, sessionID)
      return
    }

    // Handle message updates
    if (event.type === "message.updated" && props?.info?.role === "assistant") {
      return
    }

    // Handle session idle - main loop trigger
    if (event.type === "session.idle" && sessionID === getSessionID(state)) {
      const now = Date.now()
      if (now - (sessionState.lastIterationTime || 0) < CONSTANTS.ITERATION_DEBOUNCE_MS) {
        logger.debug("Skipping: too soon since last action", { sessionID })
        return
      }

      sessionState.lastIterationTime = now

      // Fetch transcript for Advisor evaluation
      let transcript = ""
      if (getTranscript) {
        try {
          transcript = await getTranscript(sessionID)
        } catch (err) {
          logger.warn("Failed to get transcript", { sessionID, error: String(err) })
        }
      }

      const result = stateMachine.process({ type: "session_idle", transcript })
      await executeActions(result.actions, sessionID)
      return
    }
  }

  return {
    handler,
    startLoop,
    cancelLoop,
    completeLoop,
    getState,
    processPrompt,
  }
}
