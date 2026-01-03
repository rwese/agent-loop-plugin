/**
 * Iteration Loop - Iteration-based Agent Loop
 *
 * Continues prompting the agent until it outputs a completion marker.
 * Uses iteration counting and state persistence to prevent infinite loops.
 *
 * The agent must output: `<completion>MARKER_TEXT</completion>` to signal completion.
 *
 * ## How It Works
 *
 * 1. User starts a loop with `startLoop()` or via `<iterationLoop>` tag in prompt
 * 2. State is persisted to `.agent-loop/iteration-state.md` (YAML frontmatter + prompt body)
 * 3. On `session.idle`, checks transcript for completion marker
 * 4. If not found, increments iteration and sends continuation prompt
 * 5. Repeats until marker found or max iterations reached
 *
 * ## State File Format
 *
 * ```yaml
 * ---
 * active: true
 * iteration: 3
 * max_iterations: 20
 * completion_marker: "DONE"
 * started_at: "2024-01-15T10:30:00Z"
 * session_id: "abc123"
 * ---
 * Original task prompt here...
 * ```
 *
 * ## Usage Patterns
 *
 * ### Direct API:
 * ```typescript
 * // Start loop - unique codename is auto-generated
 * iterationLoop.startLoop(sessionID, "Build a REST API", {
 *   maxIterations: 20
 * });
 *
 * // Complete loop via tool call
 * iterationLoop.completeLoop(sessionID, "API fully implemented");
 * ```
 *
 * ### Via Prompt Tag:
 * ```
 * <iterationLoop max="20">
 * Build a REST API with authentication
 * </iterationLoop>
 * ```
 *
 * @module iteration-loop
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
  /** Default maximum iterations before auto-stopping (safety limit) */
  DEFAULT_MAX_ITERATIONS: 100,
  /** Minimum milliseconds between iterations to prevent duplicate triggers */
  ITERATION_DEBOUNCE_MS: 3000,
  /** Recovery mode duration in milliseconds after session errors */
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
  /** When true, skip continuation prompts (session recovering from error) */
  isRecovering?: boolean
  /** When true, an iteration is currently being processed (prevents duplicate iterations) */
  iterationInProgress?: boolean
  /** Timestamp of last successful iteration injection (for debounce calculation) */
  lastIterationTime?: number
}

/** Result of processing a prompt for iteration loop tags */
export interface ProcessPromptResult {
  /** Whether an iteration loop tag was found and loop was started */
  shouldIntercept: boolean
  /** The modified prompt to send to the AI (with tag stripped, context added) */
  modifiedPrompt: string
}

/** Public interface for the Iteration Loop */
export interface IterationLoop {
  /** Event handler to wire into plugin event system */
  handler: (input: { event: LoopEvent }) => Promise<void>
  /**
   * Start a new Iteration Loop.
   * A unique codename is auto-generated for completion tracking.
   */
  startLoop: (sessionID: string, prompt: string, options?: { maxIterations?: number }) => boolean
  /** Cancel the active loop */
  cancelLoop: (sessionID: string) => boolean
  /**
   * Complete the active loop successfully.
   * This is the preferred way to stop the loop - call this from a tool handler.
   *
   * @param sessionID - The session ID to complete the loop for
   * @param summary - Optional summary of what was accomplished
   * @returns Result with success status and iteration count
   */
  completeLoop: (sessionID: string, summary?: string) => CompleteLoopResult
  /** Get current loop state */
  getState: () => IterationLoopState | null
  /**
   * Process a user prompt, detecting and handling iteration loop tags.
   *
   * If an `<iterationLoop>` tag is found:
   * 1. Extracts task, max iterations, and marker from the tag
   * 2. Starts the iteration loop
   * 3. Returns a modified prompt with the tag stripped and iteration context added
   *
   * @param sessionID - The session ID to start the loop for
   * @param prompt - The raw user prompt that may contain an iteration loop tag
   * @returns Result indicating whether to intercept and the modified prompt
   */
  processPrompt: (sessionID: string, prompt: string) => ProcessPromptResult
}

/**
 * Create an Iteration Loop (iteration-based loop with completion marker)
 *
 * @example
 * ```typescript
 * const iterationLoop = createIterationLoop(ctx, {
 *   defaultMaxIterations: 50
 * });
 *
 * // Start a loop - unique codename is auto-generated
 * iterationLoop.startLoop(sessionID, "Build a REST API with authentication", {
 *   maxIterations: 20
 * });
 *
 * // Wire into plugin event system
 * ctx.on("event", iterationLoop.handler);
 *
 * // Complete via tool call when done
 * iterationLoop.completeLoop(sessionID, "API fully implemented");
 *
 * // Or cancel if needed
 * iterationLoop.cancelLoop(sessionID);
 * ```
 *
 * @param ctx - The OpenCode plugin context
 * @param options - Configuration options for the loop
 * @returns An IterationLoop instance with handler, startLoop, cancelLoop, completeLoop, and getState methods
 */
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
          title: "Iteration Loop",
          message: `Plugin loaded at ${loadedAt} (debug mode)`,
          variant: "info",
          duration: 2000,
        },
      })
      .catch(() => {})
  }

  /** Get or create session state */
  function getSessionState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }

  /** Escape special regex characters */
  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  /** Display a status message in the session UI */
  async function showStatusMessage(sessionID: string, message: string): Promise<void> {
    await sendIgnoredMessage(ctx.client, sessionID, message, logger, { agent, model })
  }

  /** Continue iteration with Advisor feedback */
  async function continueWithAdvisorFeedback(
    sessionID: string,
    state: IterationLoopState,
    feedback: string,
    missingItems?: string[]
  ): Promise<void> {
    // Check max iterations before continuing
    if (state.iteration >= state.max_iterations) {
      logger.warn("[continueWithAdvisorFeedback] Max iterations reached", {
        sessionID,
        iteration: state.iteration,
        max: state.max_iterations,
      })
      logToFile("Max iterations reached", {
        sessionID,
        iteration: state.iteration,
        max: state.max_iterations,
      })
      clearLoopState(ctx.directory, stateFilePath)

      await ctx.client.tui
        .showToast({
          body: {
            title: "Iteration Loop Stopped",
            message: `Max iterations (${state.max_iterations}) reached`,
            variant: "warning",
            duration: 5000,
          },
        })
        .catch(() => {})

      await showStatusMessage(
        sessionID,
        `⚠️ [session.idle] Iteration Loop: Stopped - Max iterations (${state.max_iterations}) reached`
      )
      return
    }

    // Increment iteration
    const newState = incrementIteration(ctx.directory, stateFilePath)
    if (!newState) {
      logger.error("[continueWithAdvisorFeedback] Failed to increment iteration", { sessionID })
      return
    }

    // Check if we've exceeded max iterations after increment
    if (newState.iteration > newState.max_iterations) {
      logger.warn("[continueWithAdvisorFeedback] Exceeded max iterations after increment", {
        sessionID,
        iteration: newState.iteration,
        max: newState.max_iterations,
      })
      clearLoopState(ctx.directory, stateFilePath)
      return
    }

    logger.debug(
      `[continueWithAdvisorFeedback] Starting iteration ${newState.iteration} of ${newState.max_iterations}`,
      {
        sessionID,
        iteration: newState.iteration,
        max: newState.max_iterations,
      }
    )
    logToFile(`Starting iteration ${newState.iteration} of ${newState.max_iterations}`, {
      sessionID,
      iteration: newState.iteration,
      max: newState.max_iterations,
    })

    // Build the continuation prompt with Advisor feedback
    const missingItemsText =
      missingItems && missingItems.length > 0
        ? `\n\nMissing items that need to be addressed:\n${missingItems.map((item) => `- ${item}`).join("\n")}`
        : ""

    const additionalContext = feedback
      ? `\n\nAdvisor Feedback:\n${feedback}${missingItemsText}`
      : missingItemsText

    const continuationPrompt = ADVISOR_CONTINUATION_PROMPT.replace(
      "{{ITERATION}}",
      String(newState.iteration)
    )
      .replace("{{MAX}}", String(newState.max_iterations))
      .replace("{{ITERATION_MINUS_ONE}}", String(newState.iteration - 1))
      .replace("{{PROMPT}}", newState.prompt)
      .replace("{{ADVISOR_FEEDBACK}}", feedback || "Please continue working on the task.")
      .replace("{{ADDITIONAL_CONTEXT}}", additionalContext)

    // Show toast
    ctx.client.tui
      .showToast({
        body: {
          title: "Iteration Loop",
          message: `Iteration ${newState.iteration}/${newState.max_iterations} - Advisor feedback provided`,
          variant: "info",
          duration: 2000,
        },
      })
      .catch(() => {})

    // Create inject function
    const inject = async (): Promise<void> => {
      try {
        logger.debug(
          "[continueWithAdvisorFeedback] Sending continuation prompt with Advisor feedback",
          {
            sessionID,
            iteration: newState.iteration,
            promptLength: continuationPrompt.length,
          }
        )

        await ctx.client.session.prompt({
          path: { id: sessionID },
          body: {
            agent,
            model,
            parts: [{ type: "text", text: continuationPrompt }],
          },
          query: { directory: ctx.directory },
        })

        logger.debug("[continueWithAdvisorFeedback] Continuation prompt sent successfully", {
          sessionID,
        })
        await showStatusMessage(
          sessionID,
          `🔄 [session.idle] Iteration Loop: Iteration ${newState.iteration}/${newState.max_iterations} - Advisor feedback: ${feedback.substring(0, 100)}${feedback.length > 100 ? "..." : ""}`
        )
      } catch (err) {
        const errorStr = String(err)
        logger.error("[continueWithAdvisorFeedback] Failed to inject continuation prompt", {
          sessionID,
          error: errorStr,
        })
        logToFile("Failed to inject continuation prompt", {
          sessionID,
          error: errorStr,
        })
      }
    }

    // Use onContinue callback or inject directly
    if (onContinue) {
      const callbackInfo: IterationContinueCallbackInfo = {
        sessionID,
        iteration: newState.iteration,
        maxIterations: newState.max_iterations,
        marker: newState.completion_marker,
        prompt: newState.prompt,
        inject,
      }
      try {
        onContinue(callbackInfo)
      } catch (err) {
        const errorStr = String(err)
        logger.error("[continueWithAdvisorFeedback] onContinue callback threw error", {
          sessionID,
          error: errorStr,
        })
        logToFile("onContinue callback threw error", {
          sessionID,
          error: errorStr,
        })
      }
    } else {
      await inject()
    }

    // Record iteration time for debounce
    const sessionState = getSessionState(sessionID)
    sessionState.lastIterationTime = Date.now()
  }

  /** Start a new iteration loop for the given session */
  const startLoop = (
    sessionID: string,
    prompt: string,
    loopOptions?: { maxIterations?: number }
  ): boolean => {
    // Always generate a unique codename for this loop
    // This prevents models from pattern-matching on previous completion markers
    const completionMarker = generateCodename()

    const state: IterationLoopState = {
      active: true,
      iteration: 1,
      max_iterations: loopOptions?.maxIterations ?? defaultMaxIterations,
      completion_marker: completionMarker,
      started_at: new Date().toISOString(),
      prompt,
      session_id: sessionID,
    }

    const success = writeLoopState(ctx.directory, state, stateFilePath)
    if (success) {
      logger.debug(`Starting iteration 1 of ${state.max_iterations}`, {
        sessionID,
        maxIterations: state.max_iterations,
        completionMarker: state.completion_marker,
      })
      logToFile(`Starting iteration 1 of ${state.max_iterations}`, {
        sessionID,
        maxIterations: state.max_iterations,
        completionMarker: state.completion_marker,
      })
      showStatusMessage(
        sessionID,
        `🔄 [startLoop] Iteration Loop: Started (1/${state.max_iterations}) - Use iteration_loop_complete tool when done`
      )
    }
    return success
  }

  /** Cancel an active iteration loop */
  const cancelLoop = (sessionID: string): boolean => {
    const state = readLoopState(ctx.directory, stateFilePath)
    if (!state || state.session_id !== sessionID) {
      return false
    }

    const success = clearLoopState(ctx.directory, stateFilePath)
    if (success) {
      logger.debug("Iteration loop cancelled", {
        sessionID,
        iteration: state.iteration,
      })
      showStatusMessage(
        sessionID,
        `🛑 [cancelLoop] Iteration Loop: Cancelled at iteration ${state.iteration}/${state.max_iterations}`
      )
    }
    return success
  }

  /** Get the current loop state */
  const getState = (): IterationLoopState | null => {
    return readLoopState(ctx.directory, stateFilePath)
  }

  /**
   * Complete the active loop successfully.
   * This is the preferred way to stop the loop - call this from a tool handler.
   */
  const completeLoop = (sessionID: string, summary?: string): CompleteLoopResult => {
    const state = readLoopState(ctx.directory, stateFilePath)

    if (!state || !state.active) {
      return {
        success: false,
        iterations: 0,
        message: "No active iteration loop to complete",
      }
    }

    if (state.session_id && state.session_id !== sessionID) {
      return {
        success: false,
        iterations: 0,
        message: "Session ID does not match active loop",
      }
    }

    const iterations = state.iteration
    const success = clearLoopState(ctx.directory, stateFilePath)

    if (success) {
      const summaryText = summary ? ` - ${summary}` : ""
      logger.debug(
        `Iteration loop completed via tool after ${iterations} iteration(s)${summaryText}`,
        {
          sessionID,
          iterations,
          summary,
        }
      )
      logToFile(
        `Iteration loop completed via tool after ${iterations} iteration(s)${summaryText}`,
        {
          sessionID,
          iterations,
          summary,
        }
      )

      // Show toast notification
      ctx.client.tui
        .showToast({
          body: {
            title: "Iteration Loop Complete!",
            message: `Task completed after ${iterations} iteration(s)`,
            variant: "success",
            duration: 5000,
          },
        })
        .catch(() => {})

      showStatusMessage(
        sessionID,
        `🎉 [completeLoop] Iteration Loop: Complete! Finished in ${iterations} iteration${iterations > 1 ? "s" : ""}${summaryText}`
      )

      return {
        success: true,
        iterations,
        message: `Loop completed successfully after ${iterations} iteration(s)${summaryText}`,
      }
    }

    return {
      success: false,
      iterations,
      message: "Failed to clear loop state",
    }
  }

  /** Main event handler - wire this into the plugin event system */
  const handler = async ({ event }: { event: LoopEvent }): Promise<void> => {
    const props = event.properties

    // Handle session idle - main loop trigger
    if (event.type === "session.idle") {
      const sessionID = props?.sessionID
      if (!sessionID) return

      const sessionState = getSessionState(sessionID)

      // CRITICAL: Atomic check-and-set to prevent race conditions
      // Multiple session.idle events can fire simultaneously
      if (sessionState.iterationInProgress) {
        logger.debug("[session.idle] Skipping: iteration already in progress", { sessionID })
        return
      }

      if (sessionState.isRecovering) {
        logger.debug("[session.idle] Skipping: session in recovery mode", { sessionID })
        return
      }

      const now = Date.now()
      const timeSinceLastIteration = now - (sessionState.lastIterationTime || 0)
      // Debounce: wait at least specified time between iterations
      if (timeSinceLastIteration < CONSTANTS.ITERATION_DEBOUNCE_MS) {
        logger.debug("[session.idle] Skipping: too soon since last iteration", {
          sessionID,
          timeSinceLastIteration,
        })
        return
      }

      // LOCK: Set iteration in progress IMMEDIATELY before any async operations
      sessionState.iterationInProgress = true

      const state = readLoopState(ctx.directory, stateFilePath)
      logger.debug("[session.idle] Read state", { state, directory: ctx.directory })
      if (!state || !state.active) {
        logger.debug("[session.idle] No active state, skipping")
        sessionState.iterationInProgress = false
        return
      }

      if (state.session_id && state.session_id !== sessionID) {
        sessionState.iterationInProgress = false
        return
      }

      const transcriptPath = props?.transcriptPath as string | undefined

      // Get the session transcript for Advisor evaluation
      let transcript = ""
      if (getTranscript) {
        transcript = await getTranscript(sessionID)
      } else if (transcriptPath && existsSync(transcriptPath)) {
        transcript = readFileSync(transcriptPath, "utf-8")
      } else {
        // Get messages from API
        try {
          if (ctx.client.session.message) {
            const response = await ctx.client.session.message({
              path: { id: sessionID },
              query: { limit: 50 },
            })
            const messages = Array.isArray(response) ? response : response.data || []
            transcript = messages
              .map((msg) => {
                const role = msg.info?.role || "unknown"
                const parts = msg.parts
                  ?.filter((p) => p.type === "text" && p.text)
                  .map((p) => p.text)
                  .join("\n")
                return `[${role.toUpperCase()}]\n${parts}`
              })
              .join("\n\n---\n\n")
          }
        } catch (msgErr) {
          logger.warn("[session.idle] Failed to get transcript from messages API", {
            sessionID,
            error: String(msgErr),
          })
        }
      }

      // Call the Advisor evaluator
      if (!onEvaluator) {
        logger.error(
          "[session.idle] No onEvaluator callback provided - iteration loop requires Advisor-based completion detection"
        )
        logToFile("No onEvaluator callback provided", {
          sessionID,
          error: "Advisor-based completion detection is required",
        })

        // Clear state and show error
        clearLoopState(ctx.directory, stateFilePath)
        await ctx.client.tui
          .showToast({
            body: {
              title: "Iteration Loop Error",
              message: "No completion evaluator configured",
              variant: "error",
              duration: 5000,
            },
          })
          .catch(() => {})

        await showStatusMessage(
          sessionID,
          `❌ [session.idle] Iteration Loop: Error - No onEvaluator callback provided`
        )
        sessionState.iterationInProgress = false
        return
      }

      const evaluatorInfo: CompletionEvaluatorInfo = {
        sessionID,
        iteration: state.iteration,
        maxIterations: state.max_iterations,
        prompt: state.prompt,
        transcript,
        complete: (summary?: string) => completeLoop(sessionID, summary),
        continueWithFeedback: async (feedback: string, missingItems?: string[]) => {
          await continueWithAdvisorFeedback(sessionID, state, feedback, missingItems)
        },
      }

      const evaluation = await onEvaluator(evaluatorInfo)

      if (evaluation.isComplete) {
        // Advisor says task is complete
        logger.debug("[session.idle] Advisor indicated task completion", {
          sessionID,
          iteration: state.iteration,
          feedback: evaluation.feedback,
          confidence: evaluation.confidence,
        })
        logToFile("Advisor indicated task completion", {
          sessionID,
          iteration: state.iteration,
          feedback: evaluation.feedback,
          confidence: evaluation.confidence,
        })

        clearLoopState(ctx.directory, stateFilePath)

        await ctx.client.tui
          .showToast({
            body: {
              title: "Iteration Loop Complete!",
              message: `Task completed after ${state.iteration} iteration(s): ${evaluation.feedback}`,
              variant: "success",
              duration: 5000,
            },
          })
          .catch(() => {})

        await showStatusMessage(
          sessionID,
          `🎉 [session.idle] Iteration Loop: Complete! Finished in ${state.iteration} iteration${state.iteration > 1 ? "s" : ""}. Advisor feedback: ${evaluation.feedback}`
        )
        sessionState.iterationInProgress = false
        return
      } else {
        // Advisor says task is NOT complete - continue with feedback
        logger.debug("[session.idle] Advisor indicated task not complete", {
          sessionID,
          iteration: state.iteration,
          feedback: evaluation.feedback,
          missingItems: evaluation.missingItems,
        })
        logToFile("Advisor indicated task not complete, continuing with feedback", {
          sessionID,
          iteration: state.iteration,
          feedback: evaluation.feedback,
          missingItems: evaluation.missingItems,
        })

        // Continue with the Advisor feedback
        await continueWithAdvisorFeedback(
          sessionID,
          state,
          evaluation.feedback,
          evaluation.missingItems
        )
        sessionState.iterationInProgress = false
        return
      }
    }

    // Handle session deletion
    if (event.type === "session.deleted") {
      const sessionInfo = props?.info
      if (sessionInfo?.id) {
        const state = readLoopState(ctx.directory, stateFilePath)
        if (state?.session_id === sessionInfo.id) {
          clearLoopState(ctx.directory, stateFilePath)
          logger.debug("[session.deleted] Session deleted, loop cleared", {
            sessionID: sessionInfo.id,
          })
        }
        sessions.delete(sessionInfo.id)
      }
    }

    // Handle assistant message - clear iteration lock when AI starts responding
    if (event.type === "message.updated" || event.type === "message.part.updated") {
      const info = props?.info as { sessionID?: string; role?: string } | undefined
      const sessionID = info?.sessionID || (props?.part as { sessionID?: string })?.sessionID
      const role = info?.role || (props?.info as { role?: string })?.role

      if (sessionID && role === "assistant") {
        const sessionState = getSessionState(sessionID)
        if (sessionState.iterationInProgress) {
          logger.debug("[message.updated] AI responding, clearing iteration lock", { sessionID })
          sessionState.iterationInProgress = false
        }
      }
    }

    // Handle session errors - mark as recovering briefly
    if (event.type === "session.error") {
      const sessionID = props?.sessionID
      if (sessionID) {
        logger.debug("[session.error] Session error detected, entering recovery mode", {
          sessionID,
        })
        const sessionState = getSessionState(sessionID)
        sessionState.isRecovering = true
        setTimeout(() => {
          sessionState.isRecovering = false
        }, CONSTANTS.RECOVERY_TIMEOUT_MS)
      }
    }
  }

  const processPrompt = (sessionID: string, prompt: string): ProcessPromptResult => {
    const parsed = parseIterationLoopTag(prompt)

    if (!parsed.found || !parsed.task) {
      return { shouldIntercept: false, modifiedPrompt: prompt }
    }

    const maxIterations = parsed.maxIterations ?? defaultMaxIterations

    // Start the loop (codename is auto-generated inside startLoop)
    const success = startLoop(sessionID, parsed.task, {
      maxIterations,
    })

    if (!success) {
      logger.error("Failed to start iteration loop from prompt tag", { sessionID })
      return { shouldIntercept: false, modifiedPrompt: prompt }
    }

    // Get the generated codename from state
    const state = getState()
    const marker = state?.completion_marker ?? "UNKNOWN"

    // Build the modified prompt
    const modifiedPrompt = buildIterationStartPrompt(
      parsed.task,
      maxIterations,
      marker,
      parsed.cleanedPrompt
    )

    logger.debug("Iteration loop started from prompt tag", {
      sessionID,
      task: parsed.task,
      maxIterations,
      marker,
    })

    // Emit status message so user knows loop has started
    showStatusMessage(
      sessionID,
      `🚀 [processPrompt] Iteration Loop: Started (1/${maxIterations}) - Will continue until <completion>${marker}</completion>`
    )

    return { shouldIntercept: true, modifiedPrompt }
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
