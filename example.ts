/**
 * Example: How to use agent-loop in an OpenCode plugin
 *
 * This demonstrates both loop mechanisms working together.
 */

import { createTaskLoop, createIterationLoop, sendIgnoredMessage } from "./index.js"
import type { PluginContext } from "./index.js"

/**
 * Example OpenCode plugin using agent loops
 */
export default function examplePlugin(ctx: PluginContext) {
  // ===== 1. Create Task Loop =====
  const taskLoop = createTaskLoop(ctx, {
    countdownSeconds: 3,
    errorCooldownMs: 5000,
    toastDurationMs: 1000,
  })

  // ===== 2. Create Iteration Loop =====
  const iterationLoop = createIterationLoop(ctx, {
    defaultMaxIterations: 50,
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
     * Start an Iteration Loop manually.
     * A unique codename is auto-generated for completion tracking.
     *
     * @example
     * plugin.startIterationLoop("session-123", "Build a REST API", {
     *   maxIterations: 20
     * });
     */
    startIterationLoop: (sessionID: string, task: string, options?: { maxIterations?: number }) => {
      return iterationLoop.startLoop(sessionID, task, options)
    },

    /**
     * Cancel active Iteration Loop
     */
    cancelIterationLoop: (sessionID: string) => {
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
      taskLoop.markRecovering(sessionID)
    },

    /**
     * Resume Task Loop after recovery
     */
    resumeTaskLoop: (sessionID: string) => {
      taskLoop.markRecoveryComplete(sessionID)
    },

    /**
     * Clean up Task Loop session state
     */
    cleanupTaskLoop: (sessionID: string) => {
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
  // A unique codename is auto-generated for completion tracking
  plugin.startIterationLoop(
    "session-123",
    `Create a complete REST API with:
    - User authentication (JWT)
    - CRUD endpoints for users
    - Database integration (PostgreSQL)
    - API documentation
    - Unit tests
    
    When complete, use the iteration_loop_complete tool.`,
    {
      maxIterations: 30,
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
  // Completion is signaled via the iteration_loop_complete tool
  plugin.startIterationLoop(
    "session-456",
    `Implement feature X with full test coverage.
    
    When complete, use the iteration_loop_complete tool.`,
    {
      maxIterations: 15,
    }
  )

  // Task Loop will automatically handle sub-tasks:
  // 1. Agent creates todos for implementation steps
  // 2. Task Loop keeps agent working on each todo
  // 3. When all todos done, session goes idle
  // 4. Iteration Loop prompts agent to review progress
  // 5. If not complete, agent continues working
  // 6. Agent can create new todos in next iteration
  // 7. Process repeats until agent calls iteration_loop_complete tool or max iterations

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

    // Show status message for error (ignored message so it doesn't affect AI context)
    await sendIgnoredMessage(
      ctx.client,
      sessionID,
      "⚠️ [Error Handler] Session error detected - pausing task loop for recovery"
    )

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
      // Progress: state.iteration / state.max_iterations
      // Warning at 90%
      if (state.iteration / state.max_iterations > 0.9) {
        // Approaching max iterations
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

  // Completion is signaled via the iteration_loop_complete tool
  plugin.startIterationLoop(
    "session-999",
    `Deploy the application to production.
    
    Checklist:
    - [ ] Tests passing
    - [ ] Docker image built
    - [ ] Deployed to staging
    - [ ] Smoke tests passed
    - [ ] Deployed to production
    
    When ALL steps complete, use the iteration_loop_complete tool.`,
    {
      maxIterations: 10,
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
    // Clean up task loop state
    plugin.cleanupTaskLoop(sessionID)

    // Cancel any active iteration loops
    plugin.cancelIterationLoop(sessionID)
  }

  // In real plugin: ctx.on("shutdown", cleanup);

  return { plugin, cleanup }
}

/**
 * Example 8: User-initiated iteration loop via prompt tag
 *
 * Users can embed <iterationLoop> tags directly in their prompts.
 * The tag is stripped before reaching the AI, and the loop is started automatically.
 */
export function example8_PromptTagTrigger(ctx: PluginContext) {
  const plugin = examplePlugin(ctx)

  // Simulate prompt interception (in real plugin, use ctx.on("prompt.before", ...))
  const handleUserPrompt = async (sessionID: string, userPrompt: string) => {
    // Process the prompt for iteration loop tags
    const result = plugin.loops.iteration.processPrompt(sessionID, userPrompt)

    if (result.shouldIntercept) {
      // Tag was found - send the modified prompt instead
      // Show status message as ignored message so it doesn't affect AI context
      await sendIgnoredMessage(
        ctx.client,
        sessionID,
        `🚀 [Iteration Loop] Loop started - Modified prompt:\n${result.modifiedPrompt}`
      )
      // In real plugin, you would send result.modifiedPrompt to the AI
      // await ctx.client.session.prompt({ ... body: { parts: [{ type: "text", text: result.modifiedPrompt }] } })
    } else {
      // No tag found - show status message (for debugging/learning purposes)
      await sendIgnoredMessage(
        ctx.client,
        sessionID,
        "ℹ️ [Iteration Loop] No iteration tag found - sending original prompt to AI"
      )
    }

    return result
  }

  // Example usage:
  // User types: "<iterationLoop max="20" marker="API_DONE">Build a REST API</iterationLoop>"
  // Result: Loop starts, AI receives formatted prompt with iteration context

  return { plugin, handleUserPrompt }
}

/**
 * Example 9: Full plugin with prompt tag integration
 *
 * Complete example showing how to wire up prompt tag processing
 * in an OpenCode plugin.
 */
export function example9_FullPluginWithPromptTags(
  ctx: PluginContext & {
    on: (
      event: string,
      handler: (arg: {
        sessionID: string
        prompt: string
        setPrompt: (newPrompt: string) => void
      }) => void
    ) => void
  }
) {
  const plugin = examplePlugin(ctx)

  // Wire event handler for loop continuation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.on("event", plugin.handleEvent as any)

  // Wire prompt interception for tag parsing
  ctx.on("prompt.before", (event) => {
    const result = plugin.loops.iteration.processPrompt(event.sessionID, event.prompt)

    if (result.shouldIntercept) {
      // Replace prompt with iteration-aware version
      event.setPrompt(result.modifiedPrompt)
    }
  })

  return plugin
}

/**
 * Example prompt tag syntax:
 *
 * Basic (unique codename auto-generated):
 * ```
 * <iterationLoop>
 * Build a complete REST API with authentication
 * </iterationLoop>
 * ```
 *
 * With max iterations:
 * ```
 * <iterationLoop max="20">
 * Refactor the database layer
 * </iterationLoop>
 * ```
 *
 * Self-closing (task in attribute):
 * ```
 * <iterationLoop task="Fix all linting errors" max="10" />
 * ```
 *
 * Mixed with other content (tag is stripped, content preserved):
 * ```
 * Please help me with this:
 *
 * <iterationLoop max="20">
 * Build a REST API with full test coverage
 * </iterationLoop>
 *
 * Make sure to follow best practices!
 * ```
 *
 * Note: The agent signals completion by calling the iteration_loop_complete tool.
 * A unique codename is auto-generated for each loop to prevent pattern matching.
 */
