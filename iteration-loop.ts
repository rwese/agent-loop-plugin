/**
 * Iteration Loop - Iteration-based Agent Loop
 *
 * Continues prompting the agent until it outputs a completion marker.
 * Uses iteration counting and state persistence to prevent infinite loops.
 *
 * The agent must output: <completion>MARKER_TEXT</completion> to signal completion.
 */

import { existsSync, readFileSync } from "node:fs"
import type {
  PluginContext,
  IterationLoopState,
  IterationLoopOptions,
  LoopEvent,
  Logger,
} from "./types.js"
import {
  createLogger,
  readLoopState,
  writeLoopState,
  clearLoopState,
  incrementIteration,
  sendIgnoredMessage,
  writeOutput,
} from "./utils.js"

const DEFAULT_MAX_ITERATIONS = 100
const DEFAULT_COMPLETION_MARKER = "DONE"

const CONTINUATION_PROMPT = `[ITERATION LOOP - ITERATION {{ITERATION}}/{{MAX}}]

Your previous attempt did not output the completion marker. Continue working on the task.

IMPORTANT:
- Review your progress so far
- Continue from where you left off  
- When FULLY complete, output: <completion>{{MARKER}}</completion>
- Do not stop until the task is truly done

Original task:
{{PROMPT}}`

interface SessionState {
  isRecovering?: boolean
}

export interface IterationLoop {
  /** Event handler to wire into plugin event system */
  handler: (input: { event: LoopEvent }) => Promise<void>

  /** Start a new Iteration Loop */
  startLoop: (
    sessionID: string,
    prompt: string,
    options?: { maxIterations?: number; completionMarker?: string }
  ) => boolean

  /** Cancel the active loop */
  cancelLoop: (sessionID: string) => boolean

  /** Get current loop state */
  getState: () => IterationLoopState | null
}

/**
 * Create an Iteration Loop (iteration-based loop with completion marker)
 *
 * @example
 * ```typescript
 * const iterationLoop = createIterationLoop(ctx, {
 *   defaultMaxIterations: 50,
 *   defaultCompletionMarker: "TASK_COMPLETE"
 * });
 *
 * // Start a loop
 * iterationLoop.startLoop(sessionID, "Build a REST API with authentication", {
 *   maxIterations: 20,
 *   completionMarker: "API_READY"
 * });
 *
 * // Wire into plugin event system
 * ctx.on("event", iterationLoop.handler);
 *
 * // Cancel if needed
 * iterationLoop.cancelLoop(sessionID);
 * ```
 */
export function createIterationLoop(
  ctx: PluginContext,
  options: IterationLoopOptions = {}
): IterationLoop {
  const {
    defaultMaxIterations = DEFAULT_MAX_ITERATIONS,
    defaultCompletionMarker = DEFAULT_COMPLETION_MARKER,
    stateFilePath,
    logger: customLogger,
    logLevel = "info",
    agent,
    model,
    outputFilePath,
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

  function getSessionState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }

  function detectCompletionMarker(transcriptPath: string | undefined, marker: string): boolean {
    if (!transcriptPath) return false

    try {
      if (!existsSync(transcriptPath)) return false

      const content = readFileSync(transcriptPath, "utf-8")
      const pattern = new RegExp(`<completion>\\s*${escapeRegex(marker)}\\s*</completion>`, "is")
      return pattern.test(content)
    } catch {
      return false
    }
  }

  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  async function showStatusMessage(sessionID: string, message: string): Promise<void> {
    await sendIgnoredMessage(ctx.client, sessionID, message, logger, { agent, model })
  }

  const startLoop = (
    sessionID: string,
    prompt: string,
    loopOptions?: { maxIterations?: number; completionMarker?: string }
  ): boolean => {
    const state: IterationLoopState = {
      active: true,
      iteration: 1,
      max_iterations: loopOptions?.maxIterations ?? defaultMaxIterations,
      completion_marker: loopOptions?.completionMarker ?? defaultCompletionMarker,
      started_at: new Date().toISOString(),
      prompt,
      session_id: sessionID,
    }

    const success = writeLoopState(ctx.directory, state, stateFilePath)
    if (success) {
      logger.info(`Starting iteration 1 of ${state.max_iterations}`, {
        sessionID,
        maxIterations: state.max_iterations,
        completionMarker: state.completion_marker,
      })
      logToFile(`Starting iteration 1 of ${state.max_iterations}`, {
        sessionID,
        maxIterations: state.max_iterations,
        completionMarker: state.completion_marker,
      })
    }
    return success
  }

  const cancelLoop = (sessionID: string): boolean => {
    const state = readLoopState(ctx.directory, stateFilePath)
    if (!state || state.session_id !== sessionID) {
      return false
    }

    const success = clearLoopState(ctx.directory, stateFilePath)
    if (success) {
      logger.info("Iteration loop cancelled", {
        sessionID,
        iteration: state.iteration,
      })
    }
    return success
  }

  const getState = (): IterationLoopState | null => {
    return readLoopState(ctx.directory, stateFilePath)
  }

  const handler = async ({ event }: { event: LoopEvent }): Promise<void> => {
    const props = event.properties

    // Handle session idle - main loop trigger
    if (event.type === "session.idle") {
      const sessionID = props?.sessionID
      if (!sessionID) return

      const sessionState = getSessionState(sessionID)
      if (sessionState.isRecovering) {
        logger.debug("Skipping: session in recovery mode", { sessionID })
        return
      }

      const state = readLoopState(ctx.directory, stateFilePath)
      if (!state || !state.active) {
        return
      }

      if (state.session_id && state.session_id !== sessionID) {
        return
      }

      const transcriptPath = props?.transcriptPath as string | undefined

      // Check for completion
      logger.debug("Checking for completion marker...", {
        sessionID,
        marker: state.completion_marker,
      })

      if (detectCompletionMarker(transcriptPath, state.completion_marker)) {
        logger.info(
          `Completion detected! Task finished in ${state.iteration} iteration${state.iteration > 1 ? "s" : ""}`,
          {
            sessionID,
            iteration: state.iteration,
            marker: state.completion_marker,
          }
        )
        logToFile(
          `Completion detected! Task finished in ${state.iteration} iteration${state.iteration > 1 ? "s" : ""}`,
          {
            sessionID,
            iteration: state.iteration,
            marker: state.completion_marker,
          }
        )
        clearLoopState(ctx.directory, stateFilePath)

        await ctx.client.tui
          .showToast({
            body: {
              title: "Iteration Loop Complete!",
              message: `Task completed after ${state.iteration} iteration(s)`,
              variant: "success",
              duration: 5000,
            },
          })
          .catch(() => {})

        return
      }

      // Check max iterations
      if (state.iteration >= state.max_iterations) {
        logger.warn("Max iterations reached without completion", {
          sessionID,
          iteration: state.iteration,
          max: state.max_iterations,
        })
        logToFile("Max iterations reached without completion", {
          sessionID,
          iteration: state.iteration,
          max: state.max_iterations,
        })
        clearLoopState(ctx.directory, stateFilePath)

        await ctx.client.tui
          .showToast({
            body: {
              title: "Iteration Loop Stopped",
              message: `Max iterations (${state.max_iterations}) reached without completion`,
              variant: "warning",
              duration: 5000,
            },
          })
          .catch(() => {})

        return
      }

      // Increment and continue
      const newState = incrementIteration(ctx.directory, stateFilePath)
      if (!newState) {
        logger.error("Failed to increment iteration", { sessionID })
        return
      }

      logger.info(`Starting iteration ${newState.iteration} of ${newState.max_iterations}`, {
        sessionID,
        iteration: newState.iteration,
        max: newState.max_iterations,
      })
      logToFile(`Starting iteration ${newState.iteration} of ${newState.max_iterations}`, {
        sessionID,
        iteration: newState.iteration,
        max: newState.max_iterations,
      })

      const continuationPrompt = CONTINUATION_PROMPT.replace(
        "{{ITERATION}}",
        String(newState.iteration)
      )
        .replace("{{MAX}}", String(newState.max_iterations))
        .replace("{{MARKER}}", newState.completion_marker)
        .replace("{{PROMPT}}", newState.prompt)

      await ctx.client.tui
        .showToast({
          body: {
            title: "Iteration Loop",
            message: `Iteration ${newState.iteration}/${newState.max_iterations}`,
            variant: "info",
            duration: 2000,
          },
        })
        .catch(() => {})

      try {
        await ctx.client.session.prompt({
          path: { id: sessionID },
          body: {
            agent,
            model,
            parts: [{ type: "text", text: continuationPrompt }],
          },
          query: { directory: ctx.directory },
        })
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

    // Handle session deletion
    if (event.type === "session.deleted") {
      const sessionInfo = props?.info
      if (sessionInfo?.id) {
        const state = readLoopState(ctx.directory, stateFilePath)
        if (state?.session_id === sessionInfo.id) {
          clearLoopState(ctx.directory, stateFilePath)
          logger.debug("Session deleted, loop cleared", {
            sessionID: sessionInfo.id,
          })
        }
        sessions.delete(sessionInfo.id)
      }
    }

    // Handle session errors - mark as recovering briefly
    if (event.type === "session.error") {
      const sessionID = props?.sessionID
      if (sessionID) {
        const sessionState = getSessionState(sessionID)
        sessionState.isRecovering = true
        setTimeout(() => {
          sessionState.isRecovering = false
        }, 5000)
      }
    }
  }

  return {
    handler,
    startLoop,
    cancelLoop,
    getState,
  }
}
