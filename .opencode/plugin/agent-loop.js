/**
 * Agent Loop Plugin v2.1.0
 *
 * Integrates the oc-agent-loop library for automatic task continuation
 * and iteration-based loops.
 *
 * @see https://codeberg.org/nope-at/oc-agent-loop
 *
 * Version: 2.1.0 (Advisor-based iteration loop completion)
 *
 * Features:
 * - Task Loop: Automatically continues sessions when incomplete tasks remain
 * - Iteration Loop: Iteration-based loop with Advisor-based completion detection
 *
 * Usage:
 *   npm install oc-agent-loop
 *
 *   import { AgentLoopPlugin } from "oc-agent-loop/.opencode/plugin"
 *
 * Configuration via environment variables:
 * - AGENT_LOOP_COUNTDOWN_SECONDS: Countdown before auto-continue (default: 5)
 * - AGENT_LOOP_ERROR_COOLDOWN_MS: Error cooldown in ms (default: 3000)
 * - AGENT_LOOP_TOAST_DURATION_MS: Toast duration in ms (default: 900)
 * - AGENT_LOOP_MAX_ITERATIONS: Default max iterations (default: 10)
 * - AGENT_LOOP_LOG_LEVEL: Log level - silent|error|warn|info|debug (default: "info")
 * - AGENT_LOOP_HELP_AGENT: Subagent name for help/feedback (e.g., "advisor")
 */

/** Version of oc-agent-loop package being used */
const PLUGIN_VERSION = "2.1.0"

import {
  createTaskLoop,
  createIterationLoop,
  sendIgnoredMessage,
  parseIterationLoopTag,
  buildIterationStartPrompt,
} from "oc-agent-loop"
import { z } from "zod"

// Simple tool helper that wraps the tool definition
const tool = (input) => input
tool.schema = z

export const AgentLoopPlugin = async ({ directory, client }) => {
  // Create plugin context matching oc-agent-loop's PluginContext interface
  const ctx = {
    directory,
    client: {
      session: {
        prompt: (opts) => client.session.prompt(opts),
        todo: (opts) => client.session.todo(opts),
        message: (opts) => client.session.message(opts),
      },
      tui: {
        showToast: (opts) => client.tui.showToast(opts),
      },
    },
  }

  // Configuration from environment variables
  const config = {
    countdownSeconds: parseInt(process.env.AGENT_LOOP_COUNTDOWN_SECONDS || "5", 10),
    errorCooldownMs: parseInt(process.env.AGENT_LOOP_ERROR_COOLDOWN_MS || "3000", 10),
    toastDurationMs: parseInt(process.env.AGENT_LOOP_TOAST_DURATION_MS || "900", 10),
    defaultMaxIterations: parseInt(process.env.AGENT_LOOP_MAX_ITERATIONS || "10", 10),
    logLevel: process.env.AGENT_LOOP_LOG_LEVEL || "info",
    // Name of subagent for help/feedback (e.g., "advisor")
    helpAgent: process.env.AGENT_LOOP_HELP_AGENT || "advisor",
  }

  // Track pending countdowns (plugin-side timer management)
  const pendingCountdowns = new Map()

  // Track when countdown started for each session (to detect new user messages)
  const countdownStartTimes = new Map()

  // Track when we last injected (to ignore our own injected messages)
  const lastInjectionTimes = new Map()

  // Cancel countdown for a session
  function cancelCountdown(sessionID) {
    const pending = pendingCountdowns.get(sessionID)
    if (pending) {
      pending.abort?.()
      pendingCountdowns.delete(sessionID)
      countdownStartTimes.delete(sessionID)
    }
  }

  // Create Task Loop - auto-continues when incomplete tasks remain
  // Use onCountdownStart callback so plugin handles timers (library timers don't work in plugin environment)
  const taskLoop = createTaskLoop(ctx, {
    countdownSeconds: config.countdownSeconds,
    errorCooldownMs: config.errorCooldownMs,
    toastDurationMs: config.toastDurationMs,
    logLevel: config.logLevel,
    helpAgent: config.helpAgent,
    onCountdownStart: ({ sessionID, incompleteCount, inject }) => {
      cancelCountdown(sessionID)

      let aborted = false
      const runCountdown = async () => {
        for (let i = config.countdownSeconds; i > 0 && !aborted; i--) {
          ctx.client.tui
            .showToast({
              body: {
                title: "Task Continuation",
                message: `Resuming in ${i}s... (${incompleteCount} tasks) - Send message to cancel`,
                variant: "warning",
                duration: config.toastDurationMs,
              },
            })
            .catch(() => {})
          await new Promise((r) => setTimeout(r, 1000))
        }
        if (!aborted) {
          lastInjectionTimes.set(sessionID, Date.now())
          await inject().catch(() => {})
        }
        pendingCountdowns.delete(sessionID)
        countdownStartTimes.delete(sessionID)
      }

      runCountdown()
      pendingCountdowns.set(sessionID, {
        abort: () => {
          aborted = true
        },
      })
      countdownStartTimes.set(sessionID, Date.now())
    },
  })

  // Track pending iteration continuations (plugin-side management)
  const pendingIterations = new Map()

  // Track last iteration injection times
  const lastIterationInjectionTimes = new Map()

  // Cancel pending iteration for a session
  function cancelIteration(sessionID) {
    const pending = pendingIterations.get(sessionID)
    if (pending) {
      pending.abort?.()
      pendingIterations.delete(sessionID)
    }
  }

  /**
   * Advisor-based evaluator for iteration loop completion.
   * This function is called on each session.idle to determine if the task is complete.
   * It triggers a prompt for the advisor agent to evaluate progress.
   */
  async function evaluateCompletion(info) {
    const { sessionID, iteration, maxIterations, prompt, transcript } = info

    // Build the evaluation prompt for the advisor agent
    const evaluationPrompt = `[ITERATION LOOP - ADVISOR EVALUATION]

You are the **advisor agent** evaluating an iteration loop task for completion.

## Task Being Evaluated
${prompt}

## Current Status
- **Iteration:** ${iteration}/${maxIterations}
- **Session:** ${sessionID}

## Recent Work (Transcript)
${transcript ? transcript.slice(-4000) : "(No transcript available)"}

## Your Evaluation Instructions

1. **Review** the transcript to understand what work has been done
2. **Compare** against the original task requirements
3. **Decide** if the task is COMPLETE or needs more work

### If COMPLETE:
Call the \`iteration_loop_complete\` tool with a summary of what was accomplished.

### If NOT COMPLETE:
Provide specific, actionable feedback on what still needs to be done. Be constructive and clear about:
- What requirements are not yet met
- What specific steps should be taken next
- Any issues or blockers you've identified

**Important:** Be thorough but fair. A task is complete when all requirements are met, not when it's perfect. Don't require unnecessary polish.`

    try {
      // Send the evaluation prompt to the advisor agent
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: config.helpAgent, // Use the advisor agent
          parts: [{ type: "text", text: evaluationPrompt }],
        },
        query: { directory },
      })

      // Return a "pending" result - the advisor will call iteration_loop_complete if done
      // or the loop will continue with the advisor's feedback in the next iteration
      return {
        isComplete: false,
        feedback: `Advisor agent triggered for evaluation (iteration ${iteration}/${maxIterations}). Awaiting advisor response...`,
        confidence: 0.5,
      }
    } catch (error) {
      // On error, continue the loop with generic feedback
      return {
        isComplete: false,
        feedback: `Failed to trigger advisor evaluation: ${error.message}. Please continue working on the task.`,
        confidence: 0.3,
      }
    }
  }

  /**
   * Get transcript for a session.
   * This reads the transcript file if available.
   */
  async function getSessionTranscript(sessionID) {
    // The transcript path is typically passed in events, but we may not have it here
    // For now, return empty string - the evaluator will work without it
    // TODO: Implement proper transcript retrieval via client API if available
    return ""
  }

  // Create Iteration Loop - continues until completion tool is called or advisor says complete
  // Uses onEvaluator callback for Advisor-based completion detection
  const iterationLoop = createIterationLoop(ctx, {
    defaultMaxIterations: config.defaultMaxIterations,
    logLevel: config.logLevel,
    agent: config.helpAgent,
    onEvaluator: evaluateCompletion,
    getTranscript: getSessionTranscript,
  })

  return {
    // Custom tools for iteration loop control
    tool: {
      iteration_loop_start: tool({
        description: `Start an iteration loop for a complex task. The loop will continue until you call iteration_loop_complete or max iterations reached. Use this when you see <iterationLoop> tags in user prompts, or when a task requires multiple iterations to complete.`,
        args: {
          task: tool.schema.string().describe("The task to work on iteratively"),
          maxIterations: tool.schema
            .number()
            .optional()
            .describe("Maximum number of iterations (default: 10)"),
        },
        async execute(args, toolCtx) {
          const sessionID = toolCtx.sessionID
          const maxIterations = args.maxIterations || config.defaultMaxIterations

          const success = await iterationLoop.startLoop(sessionID, args.task, {
            maxIterations,
          })

          if (!success) {
            return `Failed to start iteration loop. There may already be an active loop.`
          }

          // Get the generated codename
          const state = iterationLoop.getState()
          const codename = state?.completion_marker || "UNKNOWN"

          return `Iteration loop started successfully!

Task: ${args.task}
Max Iterations: ${maxIterations}
Codename: ${codename}

The advisor will now evaluate if this task is already complete.
If complete, the loop will terminate immediately.
If not complete, you'll receive a continuation prompt to begin working.`
        },
      }),

      iteration_loop_complete: tool({
        description:
          "Signal that the iteration loop task is complete. Call this when you have fully completed the task. ONLY available to the advisor agent.",
        args: {
          summary: tool.schema
            .string()
            .optional()
            .describe("Optional summary of what was accomplished"),
        },
        async execute(args, toolCtx) {
          const sessionID = toolCtx.sessionID

          // Only allow the advisor agent to complete the iteration loop
          // This prevents premature completion by other agents
          const currentAgent = toolCtx.agent || toolCtx.info?.agent
          if (currentAgent && currentAgent !== "advisor") {
            return `🔄 **Iteration Loop Completion**

You cannot complete this iteration loop directly. The completion is controlled by the **advisor** subagent.

**What you should do instead:**

1. 🛑 **Stop working** on this task
2. 📞 **Call the advisor agent** to review your progress:

\`\`\`
/advise

Please review my progress on this iteration loop task and determine if it's complete:

- Task: ${iterationLoop.getState()?.prompt || "Unknown task"}
- Current iteration: ${iterationLoop.getState()?.iteration || "Unknown"}
- What I've accomplished so far: [Describe your work]

The advisor will evaluate whether the task is truly complete and signal completion when all requirements are met.
\`\`\`

**Why this exists:** Iteration loops prevent premature completion by having an objective advisor evaluate progress. This ensures tasks are actually finished before moving on.

**Current loop status:**
- Iteration: ${iterationLoop.getState()?.iteration || "Unknown"}/${iterationLoop.getState()?.max_iterations || "Unknown"}
- Codename: ${iterationLoop.getState()?.completion_marker || "Unknown"}

Please use the advisor to continue.`
          }

          const result = iterationLoop.completeLoop(sessionID, args.summary)

          if (!result.success) {
            return result.message
          }

          return `🎉 Iteration loop completed successfully!

Iterations: ${result.iterations}
${args.summary ? `Summary: ${args.summary}` : ""}`
        },
      }),

      iteration_loop_cancel: tool({
        description: "Cancel the active iteration loop (use when abandoning the task)",
        args: {},
        async execute(_args, toolCtx) {
          const sessionID = toolCtx.sessionID
          const success = iterationLoop.cancelLoop(sessionID)

          if (!success) {
            return "No active iteration loop to cancel."
          }

          return "Iteration loop cancelled successfully."
        },
      }),

      iteration_loop_status: tool({
        description: "Get the current status of the iteration loop",
        args: {},
        async execute() {
          const state = iterationLoop.getState()

          if (!state || !state.active) {
            return "No active iteration loop."
          }

          return `Iteration Loop Status:
- Active: ${state.active}
- Iteration: ${state.iteration}/${state.max_iterations}
- Codename: ${state.completion_marker}
- Started At: ${state.started_at}
- Task: ${state.prompt}`
        },
      }),
    },

    // Event handler - wire both loops into the event system
    event: async ({ event }) => {
      const props = event.properties

      // Cancel countdown and iteration on session error
      if (event.type === "session.error" && props?.sessionID) {
        cancelCountdown(props.sessionID)
        cancelIteration(props.sessionID)
      }

      // Cancel when assistant starts responding or user sends a new message
      if (event.type === "message.updated") {
        const { sessionID, role, time } = props?.info || {}
        if (sessionID && role === "assistant") {
          cancelCountdown(sessionID)
          cancelIteration(sessionID)
        }
        if (sessionID && role === "user") {
          // Check if this is our own injected message (task loop)
          const lastInjectionAt = lastInjectionTimes.get(sessionID)
          if (lastInjectionAt && time?.created && Math.abs(time.created - lastInjectionAt) < 2000) {
            return
          }
          // Check if this is our own injected message (iteration loop)
          const lastIterationInjectionAt = lastIterationInjectionTimes.get(sessionID)
          if (
            lastIterationInjectionAt &&
            time?.created &&
            Math.abs(time.created - lastIterationInjectionAt) < 2000
          ) {
            return
          }
          const countdownStartedAt = countdownStartTimes.get(sessionID)
          if (time?.created && countdownStartedAt && time.created > countdownStartedAt) {
            cancelCountdown(sessionID)
          }
        }
      }

      // Cancel when assistant message part is updated
      if (event.type === "message.part.updated") {
        const { sessionID, role } = props?.info || {}
        if (sessionID && role === "assistant") {
          cancelCountdown(sessionID)
          cancelIteration(sessionID)
        }
      }

      // Cancel when tool execution starts or ends
      if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
        if (props?.sessionID) {
          cancelCountdown(props.sessionID)
          cancelIteration(props.sessionID)
        }
      }

      // Clean up on session deletion
      if (event.type === "session.deleted" && props?.info?.id) {
        cancelCountdown(props.info.id)
        cancelIteration(props.info.id)
      }

      // Both handlers are idempotent and can run in parallel
      await Promise.all([taskLoop.handler({ event }), iterationLoop.handler({ event })])
    },

    // Expose loop controls for manual usage
    loops: {
      task: taskLoop,
      iteration: iterationLoop,
    },

    // Convenience methods
    startIterationLoop: (sessionID, prompt, options) => {
      return iterationLoop.startLoop(sessionID, prompt, options)
    },

    cancelIterationLoop: (sessionID) => {
      return iterationLoop.cancelLoop(sessionID)
    },

    getIterationLoopState: () => {
      return iterationLoop.getState()
    },

    pauseTaskLoop: (sessionID) => {
      taskLoop.markRecovering(sessionID)
    },

    resumeTaskLoop: (sessionID) => {
      taskLoop.markRecoveryComplete(sessionID)
    },

    cleanupTaskLoop: (sessionID) => {
      taskLoop.cleanup(sessionID)
    },

    // Send a message visible in UI but NOT added to model context
    sendStatusMessage: async (sessionID, message) => {
      await sendIgnoredMessage(ctx.client, sessionID, message)
    },
  }
}

// Default export for OpenCode plugin loader
export const main = AgentLoopPlugin
