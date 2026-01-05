/**
 * Iteration Loop - Continues iterations until task is complete
 *
 * A simplified implementation that:
 * 1. Tracks loop state in memory and persists to file
 * 2. On session.idle, calls the evaluator to check completion
 * 3. Either completes the loop or continues with feedback
 */

import type {
  PluginContext,
  IterationLoopState,
  IterationLoopOptions,
  LoopEvent,
  Logger,
  CompleteLoopResult,
} from "./types.js"
import {
  createLogger,
  readLoopState,
  writeLoopState,
  clearLoopState,
  incrementIteration,
  sendIgnoredMessage,
  generateCodename,
} from "./utils.js"
import { parseIterationLoopTag, buildIterationStartPrompt } from "./prompt-parser.js"

const DEFAULT_MAX_ITERATIONS = 100
const ITERATION_DEBOUNCE_MS = 3000

/** Continuation prompt template */
const CONTINUATION_PROMPT = `[ITERATION LOOP - ITERATION {{ITERATION}}/{{MAX}}]

You have completed {{ITERATION_MINUS_ONE}} iteration(s).

{{ADVISOR_FEEDBACK}}

Please address the issues above and continue working on the task.

{{PROMPT}}`

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
    defaultMaxIterations = DEFAULT_MAX_ITERATIONS,
    stateFilePath,
    logger: customLogger,
    logLevel = "info",
    agent,
    model,
    onEvaluator,
    getTranscript,
  } = options

  const logger: Logger = createLogger(customLogger, logLevel)

  // In-memory state (restored from file on creation)
  let activeSessionID: string | null = null
  let currentIteration = 0
  let maxIterations = defaultMaxIterations
  let currentPrompt = ""
  let lastIterationTime = 0

  // Restore state from file on creation
  const existingState = readLoopState(ctx.directory, stateFilePath)
  if (existingState?.active) {
    activeSessionID = existingState.session_id || null
    currentIteration = existingState.iteration
    maxIterations = existingState.max_iterations
    currentPrompt = existingState.prompt
    logger.info("Restored iteration loop state", {
      sessionID: activeSessionID,
      iteration: currentIteration,
      maxIterations,
    })
  }

  const showToast = (
    title: string,
    message: string,
    variant: "info" | "success" | "warning" | "error"
  ) => ctx.client.tui.showToast({ body: { title, message, variant, duration: 5000 } }).catch(() => {})

  const sendStatus = (sessionID: string, message: string) =>
    sendIgnoredMessage(ctx.client, sessionID, message, logger, { agent, model })

  async function sendContinuationPrompt(sessionID: string, feedback: string): Promise<void> {
    const prompt = CONTINUATION_PROMPT.replace("{{ITERATION}}", String(currentIteration + 1))
      .replace("{{MAX}}", String(maxIterations))
      .replace("{{ITERATION_MINUS_ONE}}", String(currentIteration))
      .replace("{{PROMPT}}", currentPrompt)
      .replace("{{ADVISOR_FEEDBACK}}", feedback || "Please continue working on the task.")

    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: { agent, model, parts: [{ type: "text", text: prompt }] },
      query: { directory: ctx.directory },
    })
  }

  function resetState(): void {
    activeSessionID = null
    currentIteration = 0
    maxIterations = defaultMaxIterations
    currentPrompt = ""
    clearLoopState(ctx.directory, stateFilePath)
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  const startLoop = async (
    sessionID: string,
    prompt: string,
    loopOptions?: { maxIterations?: number }
  ): Promise<boolean> => {
    const max = loopOptions?.maxIterations ?? defaultMaxIterations
    const codename = generateCodename()

    const state: IterationLoopState = {
      active: true,
      iteration: 1,
      max_iterations: max,
      completion_marker: codename,
      started_at: new Date().toISOString(),
      prompt,
      session_id: sessionID,
    }

    const success = writeLoopState(ctx.directory, state, stateFilePath)
    if (success) {
      activeSessionID = sessionID
      currentIteration = 1
      maxIterations = max
      currentPrompt = prompt
      await sendStatus(
        sessionID,
        `🔄 [startLoop] Iteration Loop: Started (1/${max}) - Advisor will evaluate completion`
      )
    }
    return success
  }

  const cancelLoop = (sessionID: string): boolean => {
    if (activeSessionID !== sessionID) return false

    const iterations = currentIteration
    resetState()
    showToast("Iteration Loop Cancelled", `Loop cancelled at iteration ${iterations}/${maxIterations}`, "warning")
    return true
  }

  const completeLoop = (sessionID: string, summary?: string): CompleteLoopResult => {
    if (!activeSessionID) {
      return { success: false, iterations: 0, message: "No active iteration loop to complete" }
    }
    if (activeSessionID !== sessionID) {
      return { success: false, iterations: 0, message: "Session ID does not match active loop" }
    }

    const iterations = currentIteration
    resetState()
    const summaryText = summary ? ` - ${summary}` : ""
    return { success: true, iterations, message: `Loop completed successfully after ${iterations} iteration(s)${summaryText}` }
  }

  const getState = (): IterationLoopState | null => {
    return readLoopState(ctx.directory, stateFilePath)
  }

  const processPrompt = async (sessionID: string, prompt: string): Promise<ProcessPromptResult> => {
    const parsed = parseIterationLoopTag(prompt)

    if (!parsed.found || !parsed.task) {
      return { shouldIntercept: false, modifiedPrompt: prompt }
    }

    const max = parsed.maxIterations ?? defaultMaxIterations
    await startLoop(sessionID, parsed.task, { maxIterations: max })

    const state = getState()
    const marker = state?.completion_marker ?? "UNKNOWN"

    const modifiedPrompt = buildIterationStartPrompt(
      parsed.task,
      max,
      marker,
      parsed.cleanedPrompt
    )

    return { shouldIntercept: true, modifiedPrompt }
  }

  /** Handle session idle - evaluate and continue or complete */
  const handleSessionIdle = async (sessionID: string): Promise<void> => {
    // Debounce rapid idle events
    const now = Date.now()
    if (now - lastIterationTime < ITERATION_DEBOUNCE_MS) {
      logger.debug("Skipping: too soon since last action", { sessionID })
      return
    }
    lastIterationTime = now

    if (!onEvaluator) {
      logger.error("No onEvaluator callback provided", { sessionID })
      return
    }

    // Fetch transcript for evaluation
    let transcript = ""
    if (getTranscript) {
      try {
        transcript = await getTranscript(sessionID)
      } catch (err) {
        logger.warn("Failed to get transcript", { sessionID, error: String(err) })
      }
    }

    try {
      const evaluation = await onEvaluator({
        sessionID,
        iteration: currentIteration,
        maxIterations,
        prompt: currentPrompt,
        transcript,
        complete: (summary?: string) => completeLoop(sessionID, summary),
        continueWithFeedback: async () => {},
      })

      if (evaluation.isComplete) {
        const result = completeLoop(sessionID, evaluation.feedback)
        await showToast("Iteration Loop Complete!", `Task completed after ${result.iterations} iteration(s): ${evaluation.feedback}`, "success")
        await sendStatus(sessionID, `🎉 Iteration Loop: Complete! Finished in ${result.iterations} iteration(s). Advisor: ${evaluation.feedback}`)
      } else if (currentIteration >= maxIterations) {
        resetState()
        await showToast("Iteration Loop Stopped", `Max iterations (${maxIterations}) reached without completion`, "warning")
        await sendStatus(sessionID, `⚠️ Iteration Loop: Stopped - Max iterations (${maxIterations}) reached`)
      } else {
        incrementIteration(ctx.directory, stateFilePath)
        currentIteration++
        const truncatedFeedback = evaluation.feedback.length > 100 ? `${evaluation.feedback.substring(0, 100)}...` : evaluation.feedback
        await showToast("Iteration Loop", `Iteration ${currentIteration}/${maxIterations} - Advisor feedback provided`, "info")
        await sendStatus(sessionID, `🔄 Iteration Loop: Iteration ${currentIteration}/${maxIterations} - Advisor feedback: ${truncatedFeedback}`)
        await sendContinuationPrompt(sessionID, evaluation.feedback)
      }
    } catch (evalError) {
      logger.error("Advisor evaluation failed", { sessionID, error: String(evalError) })
      resetState()
      await showToast("Iteration Loop Error", `Error during evaluation: ${String(evalError)}`, "error")
    }
  }

  /** Main event handler */
  const handler = async ({ event }: { event: LoopEvent }): Promise<void> => {
    const props = event.properties
    const sessionID = props?.sessionID || props?.info?.sessionID

    // Handle session deletion
    if (event.type === "session.deleted" && props?.info?.id === activeSessionID) {
      resetState()
      await showToast("Iteration Loop Cleared", "Loop cleared due to session deletion", "info")
      return
    }

    // Early exit conditions
    if (!activeSessionID || sessionID !== activeSessionID) return
    if (event.type === "session.error") return
    if (event.type === "message.updated" && props?.info?.role === "assistant") return

    // Handle session idle
    if (event.type === "session.idle") {
      await handleSessionIdle(sessionID)
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
