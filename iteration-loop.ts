/**
 * Iteration Loop - Iteration-based Agent Loop
 *
 * Continues prompting the agent until it outputs a completion marker.
 * Uses iteration counting and state persistence to prevent infinite loops.
 *
 * The agent must output: <completion>MARKER_TEXT</completion> to signal completion.
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
 * iterationLoop.startLoop(sessionID, "Build a REST API", {
 *   maxIterations: 20,
 *   completionMarker: "API_READY"
 * });
 * ```
 *
 * ### Via Prompt Tag:
 * ```
 * <iterationLoop max="20" marker="API_READY">
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
import { parseIterationLoopTag, buildIterationStartPrompt } from "./prompt-parser.js"

/** Default maximum iterations before auto-stopping (safety limit) */
const DEFAULT_MAX_ITERATIONS = 100

/** Default completion marker the AI must output to signal task completion */
const DEFAULT_COMPLETION_MARKER = "DONE"

/**
 * Template for continuation prompts sent when completion marker not detected.
 * Placeholders: {{ITERATION}}, {{MAX}}, {{MARKER}}, {{PROMPT}}
 */
const CONTINUATION_PROMPT = `[ITERATION LOOP - ITERATION {{ITERATION}}/{{MAX}}]

Your previous attempt did not output the completion marker. Continue working on the task.

IMPORTANT:
- Review your progress so far
- Continue from where you left off  
- When FULLY complete, output: <completion>{{MARKER}}</completion>
- Do not stop until the task is truly done

Original task:
{{PROMPT}}`

/**
 * Per-session state for tracking recovery from errors.
 * Prevents continuation prompts during error recovery periods.
 */
interface SessionState {
  /** When true, skip continuation prompts (session recovering from error) */
  isRecovering?: boolean
}

/**
 * Result of processing a prompt for iteration loop tags
 */
export interface ProcessPromptResult {
  /** Whether an iteration loop tag was found and loop was started */
  shouldIntercept: boolean
  /** The modified prompt to send to the AI (with tag stripped, context added) */
  modifiedPrompt: string
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

  /**
   * Process a user prompt, detecting and handling iteration loop tags.
   *
   * If an <iterationLoop> tag is found:
   * 1. Extracts task, max iterations, and marker from the tag
   * 2. Starts the iteration loop
   * 3. Returns a modified prompt with the tag stripped and iteration context added
   *
   * @param sessionID - The session ID to start the loop for
   * @param prompt - The raw user prompt that may contain an iteration loop tag
   * @returns Result indicating whether to intercept and the modified prompt
   *
   * @example
   * ```typescript
   * const result = iterationLoop.processPrompt(sessionID, `
   *   <iterationLoop max="20" marker="DONE">
   *   Build a REST API
   *   </iterationLoop>
   * `);
   *
   * if (result.shouldIntercept) {
   *   // Send result.modifiedPrompt to AI instead of original
   * }
   * ```
   */
  processPrompt: (sessionID: string, prompt: string) => ProcessPromptResult
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

  /**
   * Get or create session state for tracking recovery status.
   * Uses lazy initialization pattern - creates state on first access.
   */
  function getSessionState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }

  /**
   * Check if the AI has output the completion marker in the transcript.
   * Reads the transcript file and searches for: <completion>MARKER</completion>
   *
   * @param transcriptPath - Path to the session transcript file
   * @param marker - The completion marker to search for
   * @returns true if marker found, false otherwise
   */
  function detectCompletionMarker(transcriptPath: string | undefined, marker: string): boolean {
    if (!transcriptPath) return false

    try {
      if (!existsSync(transcriptPath)) return false

      const content = readFileSync(transcriptPath, "utf-8")
      // Case-insensitive, allows whitespace around marker
      const pattern = new RegExp(`<completion>\\s*${escapeRegex(marker)}\\s*</completion>`, "is")
      return pattern.test(content)
    } catch {
      return false
    }
  }

  /**
   * Escape special regex characters in a string for safe use in RegExp.
   * Prevents injection attacks when marker contains regex metacharacters.
   */
  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  /**
   * Display a status message in the session UI without affecting AI context.
   * Uses "ignored" message type so the AI doesn't see these status updates.
   */
  async function showStatusMessage(sessionID: string, message: string): Promise<void> {
    await sendIgnoredMessage(ctx.client, sessionID, message, logger, { agent, model })
  }

  /**
   * Start a new iteration loop for the given session.
   * Creates state file and prepares for continuation prompts.
   *
   * @param sessionID - The OpenCode session ID
   * @param prompt - The task for the AI to complete
   * @param loopOptions - Optional max iterations and completion marker
   * @returns true if loop started successfully, false on error
   */
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
      showStatusMessage(
        sessionID,
        `🔄 Iteration Loop: Started (1/${state.max_iterations}) - Looking for <completion>${state.completion_marker}</completion>`
      )
    }
    return success
  }

  /**
   * Cancel an active iteration loop.
   * Only cancels if the loop belongs to the specified session.
   *
   * @param sessionID - The session ID whose loop to cancel
   * @returns true if cancelled, false if no matching loop found
   */
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
      showStatusMessage(
        sessionID,
        `🛑 Iteration Loop: Cancelled at iteration ${state.iteration}/${state.max_iterations}`
      )
    }
    return success
  }

  /** Get the current loop state from the persisted state file */
  const getState = (): IterationLoopState | null => {
    return readLoopState(ctx.directory, stateFilePath)
  }

  /**
   * Main event handler - wire this into the plugin event system.
   *
   * Responds to:
   * - session.idle: Check for completion, continue if needed
   * - session.deleted: Clean up state for deleted sessions
   * - session.error: Mark session as recovering (temporary pause)
   */
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

        await showStatusMessage(
          sessionID,
          `🎉 Iteration Loop: Complete! Finished in ${state.iteration} iteration${state.iteration > 1 ? "s" : ""}`
        )
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

        await showStatusMessage(
          sessionID,
          `⚠️ Iteration Loop: Stopped - Max iterations (${state.max_iterations}) reached without completion marker`
        )
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
        await showStatusMessage(
          sessionID,
          `🔄 Iteration Loop: Iteration ${newState.iteration}/${newState.max_iterations} - Continue until <completion>${newState.completion_marker}</completion>`
        )
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

  const processPrompt = (sessionID: string, prompt: string): ProcessPromptResult => {
    const parsed = parseIterationLoopTag(prompt)

    if (!parsed.found || !parsed.task) {
      return { shouldIntercept: false, modifiedPrompt: prompt }
    }

    const maxIterations = parsed.maxIterations ?? defaultMaxIterations
    const marker = parsed.marker ?? defaultCompletionMarker

    // Start the loop
    const success = startLoop(sessionID, parsed.task, {
      maxIterations,
      completionMarker: marker,
    })

    if (!success) {
      logger.error("Failed to start iteration loop from prompt tag", { sessionID })
      return { shouldIntercept: false, modifiedPrompt: prompt }
    }

    // Build the modified prompt
    const modifiedPrompt = buildIterationStartPrompt(
      parsed.task,
      maxIterations,
      marker,
      parsed.cleanedPrompt
    )

    logger.info("Iteration loop started from prompt tag", {
      sessionID,
      task: parsed.task,
      maxIterations,
      marker,
    })

    return { shouldIntercept: true, modifiedPrompt }
  }

  return {
    handler,
    startLoop,
    cancelLoop,
    getState,
    processPrompt,
  }
}
