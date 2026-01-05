/**
 * Agent Loop Plugin for OpenCode
 *
 * Provides task continuation and iteration loop mechanisms for OpenCode plugins.
 *
 * ## Features
 *
 * - **Task Loop**: Automatically continues sessions when incomplete todos remain
 * - **Iteration Loop**: Continues iteration until completion is signaled via tool call
 *
 * ## Usage
 *
 * Add to your OpenCode config:
 *
 * ```json
 * {
 *   "plugin": ["agent-loop-plugin"]
 * }
 * ```
 *
 * Or reference locally:
 *
 * ```json
 * {
 *   "plugin": ["./path/to/agent-loop-plugin"]
 * }
 * ```
 */

// Import the loop creation functions from the compiled module
import { createTaskLoop, createIterationLoop } from "../../dist/index.js"

/**
 * Plugin function that creates the Agent Loop plugin
 *
 * @param {Object} ctx - OpenCode plugin context
 * @param {string} ctx.directory - Working directory
 * @param {Object} ctx.client - OpenCode client API
 * @returns {Object} Plugin hooks for event handling and tools
 */
export async function AgentLoopPlugin(ctx) {
  // Get configuration from environment variables with defaults
  const countdownSeconds = parseInt(D.env.AGENT_LOOP_COUNTDOWN_SECONDS) || 3
  const errorCooldownMs = parseInt(D.env.AGENT_LOOP_ERROR_COOLDOWN_MS) || 5000
  const toastDurationMs = parseInt(D.env.AGENT_LOOP_TOAST_DURATION_MS) || 1000
  const helpAgent = D.env.AGENT_LOOP_HELP_AGENT || "advisor"
  const agent = D.env.AGENT_LOOP_AGENT
  const model = D.env.AGENT_LOOP_MODEL
  const logLevel = D.env.AGENT_LOOP_LOG_LEVEL || "info"
  const maxIterations = parseInt(D.env.AGENT_LOOP_MAX_ITERATIONS) || 50

  // Create Task Loop for automatic task continuation
  const taskLoop = createTaskLoop(ctx, {
    countdownSeconds,
    errorCooldownMs,
    toastDurationMs,
    helpAgent,
    agent,
    model,
    logLevel,
  })

  // Create Iteration Loop for structured iteration
  const iterationLoop = createIterationLoop(ctx, {
    defaultMaxIterations: maxIterations,
    agent,
    model,
    logLevel,
  })

  // Event handler for both loops
  const handleEvent = async (event) => {
    await Promise.all([taskLoop.handler({ event }), iterationLoop.handler({ event })])
  }

  // Tool implementations for iteration loop control
  const tools = {
    /**
     * Start an iteration loop for a complex task
     */
    iteration_loop_start: {
      description: "Start an iteration loop for a complex task",
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "The task to work on iteratively",
          },
          maxIterations: {
            type: "number",
            description: "Maximum number of iterations before stopping",
            default: 10,
          },
        },
        required: ["task"],
      },
      async execute(args) {
        // Get current session ID from context
        const sessionID = D.session?.id
        if (!sessionID) {
          return {
            success: false,
            error: "No active session",
          }
        }

        const started = iterationLoop.startLoop(sessionID, args.task, {
          maxIterations: args.maxIterations,
        })

        if (started) {
          const state = iterationLoop.getState()
          return {
            success: true,
            message: `Iteration loop started successfully!\n\nTask: ${args.task}\nMax Iterations: ${args.maxIterations || 50}\nCodename: ${state?.completion_marker}\n\nIMPORTANT:\n- When this task is FULLY complete, you MUST call the iteration_loop_complete tool\n- The loop will automatically continue when the session goes idle\n\nBegin working on this task now.`,
          }
        } else {
          return {
            success: false,
            error: "Failed to start iteration loop",
          }
        }
      },
    },

    /**
     * Signal that the iteration loop task is complete
     */
    iteration_loop_complete: {
      description: "Signal that the iteration loop task is complete",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "Optional summary of what was achieved",
          },
        },
      },
      async execute(args) {
        const sessionID = D.session?.id
        if (!sessionID) {
          return {
            success: false,
            error: "No active session",
          }
        }

        const result = iterationLoop.completeLoop(sessionID, args.summary)
        return {
          success: result.success,
          message: result.message,
          iterations: result.iterations,
        }
      },
    },

    /**
     * Cancel the active iteration loop
     */
    iteration_loop_cancel: {
      description: "Cancel the active iteration loop",
      parameters: {
        type: "object",
        properties: {},
      },
      async execute() {
        const sessionID = D.session?.id
        if (!sessionID) {
          return {
            success: false,
            error: "No active session",
          }
        }

        const cancelled = iterationLoop.cancelLoop(sessionID)
        return {
          success: cancelled,
          message: cancelled ? "Iteration loop cancelled" : "No active iteration loop to cancel",
        }
      },
    },

    /**
     * Get the current status of the iteration loop
     */
    iteration_loop_status: {
      description: "Get the current status of the iteration loop",
      parameters: {
        type: "object",
        properties: {},
      },
      async execute() {
        const state = iterationLoop.getState()
        if (!state) {
          return {
            active: false,
            message: "No active iteration loop",
          }
        }

        return {
          active: state.active,
          iteration: state.iteration,
          max_iterations: state.max_iterations,
          completion_marker: state.completion_marker,
          started_at: state.started_at,
          task: state.prompt,
          message: `Iteration Loop Status:\n- Active: ${state.active}\n- Iteration: ${state.iteration}/${state.max_iterations}\n- Codename: ${state.completion_marker}\n- Started At: ${state.started_at}`,
        }
      },
    },
  }

  // Return plugin hooks
  return {
    // Event handler for session events
    event: handleEvent,

    // Tool implementations
    tool: tools,

    // Expose loop controls for programmatic use
    loops: {
      task: taskLoop,
      iteration: iterationLoop,
    },

    // Utility methods
    startIterationLoop: (sessionID, task, options) => {
      return iterationLoop.startLoop(sessionID, task, options)
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
  }
}

/**
 * Default export for the plugin
 */
export default AgentLoopPlugin
