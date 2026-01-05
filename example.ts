/**
 * Example: How to use the simplified agent-loop-plugin
 *
 * This demonstrates the minimal task continuation plugin.
 */

import { createTaskContinuation, type LoopEvent, type PluginContext } from "./index.js"

/**
 * Example OpenCode plugin using task continuation
 */
export default function examplePlugin(ctx: PluginContext) {
  // Create the task continuation handler
  const taskContinuation = createTaskContinuation(ctx, {})

  // Wire into event system
  const handleEvent = async (event: LoopEvent) => {
    await taskContinuation.handler({ event })
  }

  // In a real OpenCode plugin, you'd do:
  // ctx.on("event", handleEvent);

  return {
    /**
     * Event handler (for manual wiring)
     */
    handleEvent,

    /**
     * Direct access (for advanced usage)
     */
    taskContinuation,
  }
}

// ===== Usage Examples =====

/**
 * Example 1: Basic usage with automatic task continuation
 */
export function example1_AutoTaskContinuation(ctx: PluginContext) {
  const plugin = examplePlugin(ctx)

  // That's it! Task continuation will automatically continue when:
  // 1. Session goes idle
  // 2. Tasks remain incomplete
  // 3. No errors in cooldown period

  return plugin
}

/**
 * Example 2: Error recovery with pause/resume
 */
export function example2_ErrorRecovery(ctx: PluginContext) {
  const plugin = examplePlugin(ctx)

  const handleError = async (event: LoopEvent) => {
    const sessionID = event.properties?.sessionID
    if (!sessionID) return

    // Your recovery logic here
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  return { plugin, handleError }
}

/**
 * Example 3: Graceful cleanup
 */
export function example3_GracefulShutdown(ctx: PluginContext) {
  const plugin = examplePlugin(ctx)

  return { plugin }
}
