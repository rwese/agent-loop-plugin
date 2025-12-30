/**
 * Example: How to use agent-loop in an OpenCode plugin
 *
 * This demonstrates both loop mechanisms working together.
 */

import { createTaskLoop, createIterationLoop } from "./index"
import type { PluginContext } from "./index"

/**
 * Example OpenCode plugin using agent loops
 */
export default function examplePlugin(ctx: PluginContext) {
  console.log("Initializing Agent Loop Plugin")

  // ===== 1. Create Task Loop =====
  const taskLoop = createTaskLoop(ctx, {
    countdownSeconds: 3,
    errorCooldownMs: 5000,
    toastDurationMs: 1000,
  })

  // ===== 2. Create Iteration Loop =====
  const iterationLoop = createIterationLoop(ctx, {
    defaultMaxIterations: 50,
    defaultCompletionMarker: "DONE",
    // Custom state file path (optional)
    // stateFilePath: ".my-plugin/iteration-state.md",
  })

  // ===== 3. Wire into event system =====
  // This is the key integration point!
  const handleEvent = async (event: any) => {
    // Both handlers are idempotent and can be called in parallel
    await Promise.all([taskLoop.handler({ event }), iterationLoop.handler({ event })])
  }

  // In a real OpenCode plugin, you'd do:
  // ctx.on("event", handleEvent);

  // ===== 4. Expose loop controls =====
  return {
    /**
     * Start an Iteration Loop manually
     *
     * @example
     * plugin.startIterationLoop("session-123", "Build a REST API", {
     *   maxIterations: 20,
     *   completionMarker: "API_READY"
     * });
     */
    startIterationLoop: (
      sessionID: string,
      task: string,
      options?: { maxIterations?: number; completionMarker?: string }
    ) => {
      console.log(`Starting Iteration Loop: ${task}`)
      return iterationLoop.startLoop(sessionID, task, options)
    },

    /**
     * Cancel active Iteration Loop
     */
    cancelIterationLoop: (sessionID: string) => {
      console.log(`Cancelling Iteration Loop`)
      return iterationLoop.cancelLoop(sessionID)
    },

    /**
     * Get Iteration Loop state
     */
    getIterationLoopState: () => {
      return iterationLoop.getState()
    },

    /**
     * Pause Task Loop during error recovery
     */
    pauseTaskLoop: (sessionID: string) => {
      console.log(`Pausing Task Loop for recovery`)
      taskLoop.markRecovering(sessionID)
    },

    /**
     * Resume Task Loop after recovery
     */
    resumeTaskLoop: (sessionID: string) => {
      console.log(`Resuming Task Loop`)
      taskLoop.markRecoveryComplete(sessionID)
    },

    /**
     * Clean up Task Loop session state
     */
    cleanupTaskLoop: (sessionID: string) => {
      console.log(`Cleaning up Task Loop session`)
      taskLoop.cleanup(sessionID)
    },

    /**
     * Event handler (for manual wiring)
     */
    handleEvent,

    /**
     * Direct access to loops (for advanced usage)
     */
    loops: {
      task: taskLoop,
      iteration: iterationLoop,
    },
  }
}

// ===== Usage Examples =====

/**
 * Example 1: Basic usage with automatic task continuation
 */
export function example1_AutoTaskContinuation(ctx: PluginContext) {
  const plugin = examplePlugin(ctx)

  // That's it! Task Loop will automatically continue when:
  // 1. Session goes idle
  // 2. Tasks remain incomplete
  // 3. No errors in cooldown period

  return plugin
}

/**
 * Example 2: Manual Iteration Loop for long-running tasks
 */
export function example2_ManualIterationLoop(ctx: PluginContext) {
  const plugin = examplePlugin(ctx)

  // Start an Iteration Loop for a complex task
  plugin.startIterationLoop(
    "session-123",
    `Create a complete REST API with:
    - User authentication (JWT)
    - CRUD endpoints for users
    - Database integration (PostgreSQL)
    - API documentation
    - Unit tests
    
    Output <completion>API_COMPLETE</completion> when fully done.`,
    {
      maxIterations: 30,
      completionMarker: "API_COMPLETE",
    }
  )

  return plugin
}

/**
 * Example 3: Combining both loops
 */
export function example3_CombinedLoops(ctx: PluginContext) {
  const plugin = examplePlugin(ctx)

  // Start Iteration Loop for high-level task
  plugin.startIterationLoop(
    "session-456",
    `Implement feature X with full test coverage.
    
    Output <completion>FEATURE_X_DONE</completion> when complete.`,
    {
      maxIterations: 15,
      completionMarker: "FEATURE_X_DONE",
    }
  )

  // Task Loop will automatically handle sub-tasks:
  // 1. Agent creates todos for implementation steps
  // 2. Task Loop keeps agent working on each todo
  // 3. When all todos done, session goes idle
  // 4. Iteration Loop checks for completion marker
  // 5. If not found, increments iteration and continues
  // 6. Agent can create new todos in next iteration
  // 7. Process repeats until <completion> found or max iterations

  return plugin
}

/**
 * Example 4: Error recovery with loop control
 */
export function example4_ErrorRecovery(ctx: PluginContext) {
  const plugin = examplePlugin(ctx)

  // Custom error handler
  const handleError = async (event: any) => {
    const sessionID = event.properties?.sessionID
    if (!sessionID) return

    console.error("Session error detected")

    // Pause auto-continuation during recovery
    plugin.pauseTaskLoop(sessionID)

    // Your recovery logic here
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // Resume after recovery
    plugin.resumeTaskLoop(sessionID)
  }

  // Wire up error handling
  // In real plugin: ctx.on("event", async (event) => { ... });

  return { plugin, handleError }
}

/**
 * Example 5: Monitoring loop progress
 */
export function example5_MonitoringProgress(ctx: PluginContext) {
  const plugin = examplePlugin(ctx)

  // Start a loop
  plugin.startIterationLoop("session-789", "Complex task", {
    maxIterations: 20,
  })

  // Check progress periodically
  setInterval(() => {
    const state = plugin.getIterationLoopState()
    if (state) {
      console.log(
        `Progress: ${state.iteration}/${state.max_iterations} (${Math.round(
          (state.iteration / state.max_iterations) * 100
        )}%)`
      )

      // Warning at 90%
      if (state.iteration / state.max_iterations > 0.9) {
        console.warn("Approaching max iterations!")
      }
    }
  }, 5000)

  return plugin
}

/**
 * Example 6: Custom completion conditions
 */
export function example6_CustomCompletion(ctx: PluginContext) {
  const plugin = examplePlugin(ctx)

  // Use a specific completion marker
  plugin.startIterationLoop(
    "session-999",
    `Deploy the application to production.
    
    Checklist:
    - [ ] Tests passing
    - [ ] Docker image built
    - [ ] Deployed to staging
    - [ ] Smoke tests passed
    - [ ] Deployed to production
    
    When ALL steps complete, output: <completion>DEPLOYMENT_SUCCESS</completion>`,
    {
      maxIterations: 10,
      completionMarker: "DEPLOYMENT_SUCCESS",
    }
  )

  return plugin
}

/**
 * Example 7: Graceful shutdown
 */
export function example7_GracefulShutdown(ctx: PluginContext) {
  const plugin = examplePlugin(ctx)

  // Cleanup on shutdown
  const cleanup = (sessionID: string) => {
    console.log("Shutting down agent loops")

    // Clean up task loop state
    plugin.cleanupTaskLoop(sessionID)

    // Cancel any active iteration loops
    plugin.cancelIterationLoop(sessionID)

    console.log("Cleanup complete")
  }

  // In real plugin: ctx.on("shutdown", cleanup);

  return { plugin, cleanup }
}
