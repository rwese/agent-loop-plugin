/**
 * Example: How to use the simplified agent-loop-plugin
 *
 * This demonstrates the minimal task continuation plugin.
 */

import { createTaskContinuation, type LoopEvent } from "./index.js"

/**
 * Example OpenCode plugin using task continuation
 */
export default function examplePlugin(ctx: any) {
  // Create the task continuation handler
  const taskContinuation = createTaskContinuation(ctx, {
    countdownSeconds: 3,
    errorCooldownMs: 5000,
    toastDurationMs: 1000,
  })

  // Wire into event system
  const handleEvent = async (event: LoopEvent) => {
    await taskContinuation.handler({ event })
  }

  // In a real OpenCode plugin, you'd do:
  // ctx.on("event", handleEvent);

  return {
    /**
     * Pause task continuation during error recovery
     */
    pauseContinuation: (sessionID: string) => {
      taskContinuation.markRecovering(sessionID)
    },

    /**
     * Resume after recovery
     */
    resumeContinuation: (sessionID: string) => {
      taskContinuation.markRecoveryComplete(sessionID)
    },

    /**
     * Clean up session state
     */
    cleanup: (sessionID: string) => {
      taskContinuation.cleanup(sessionID)
    },

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
export function example1_AutoTaskContinuation(ctx: any) {
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
export function example2_ErrorRecovery(ctx: any) {
  const plugin = examplePlugin(ctx)

  const handleError = async (event: LoopEvent) => {
    const sessionID = event.properties?.sessionID
    if (!sessionID) return

    // Pause auto-continuation during recovery
    plugin.pauseContinuation(sessionID)

    // Your recovery logic here
    await new Promise((resolve) => setTimeout(resolve, 5000))

    // Resume after recovery
    plugin.resumeContinuation(sessionID)
  }

  return { plugin, handleError }
}

/**
 * Example 3: Graceful cleanup
 */
export function example3_GracefulShutdown(ctx: any) {
  const plugin = examplePlugin(ctx)

  const cleanup = (sessionID: string) => {
    plugin.cleanup(sessionID)
  }

  return { plugin, cleanup }
}
