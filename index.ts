/**
 * Agent Loop - Standalone loop mechanisms extracted from oh-my-opencode
 *
 * This module provides two complementary agent loop mechanisms:
 *
 * 1. **Task Loop**: Automatically continues sessions when incomplete tasks remain
 * 2. **Iteration Loop**: Iteration-based loop that continues until completion marker is detected
 *
 * Both loops work with any OpenCode plugin context and are designed to be:
 * - Minimal dependencies
 * - Event-driven
 * - Configurable
 * - Type-safe
 *
 * @module agent-loop
 */

// Export types
export type {
  PluginContext,
  Todo,
  LoopEvent,
  IterationLoopState,
  IterationLoopOptions,
  TaskLoopOptions,
  Logger,
  LogLevel,
} from "./types.js"

// Export Task Loop
export { createTaskLoop } from "./task-loop.js"
export type { TaskLoop } from "./task-loop.js"

// Export Iteration Loop
export { createIterationLoop } from "./iteration-loop.js"
export type { IterationLoop, ProcessPromptResult } from "./iteration-loop.js"

// Export Prompt Parser
export { parseIterationLoopTag, buildIterationStartPrompt } from "./prompt-parser.js"
export type { IterationLoopTagResult } from "./prompt-parser.js"

// Export utilities
export {
  isAbortError,
  log,
  createLogger,
  createFileLogger,
  readLoopState,
  writeLoopState,
  clearLoopState,
  incrementIteration,
  sendIgnoredMessage,
  writeOutput,
  clearOutput,
  getOutputFilePath,
} from "./utils.js"

export type { SendIgnoredMessageOptions } from "./utils.js"

/**
 * Usage Example:
 *
 * ```typescript
 * import { createTaskLoop, createIterationLoop } from './agent-loop';
 * import type { PluginContext } from './agent-loop';
 *
 * // Your OpenCode plugin initialization
 * export default function myPlugin(ctx: PluginContext) {
 *
 *   // 1. Set up Task Loop
 *   const taskLoop = createTaskLoop(ctx, {
 *     countdownSeconds: 3,
 *     errorCooldownMs: 5000,
 *   });
 *
 *   // 2. Set up Iteration Loop
 *   const iterationLoop = createIterationLoop(ctx, {
 *     defaultMaxIterations: 50,
 *     defaultCompletionMarker: "DONE",
 *   });
 *
 *   // 3. Wire into event system
 *   ctx.on("event", async (event) => {
 *     await taskLoop.handler({ event });
 *     await iterationLoop.handler({ event });
 *   });
 *
 *   // 4. Optional: Start an Iteration Loop manually
 *   iterationLoop.startLoop(
 *     sessionID,
 *     "Build a complete REST API with authentication",
 *     { maxIterations: 20, completionMarker: "API_COMPLETE" }
 *   );
 *
 *   // 5. Optional: Control loop behavior
 *   taskLoop.markRecovering(sessionID); // Pause auto-continuation during recovery
 *   // ... recovery logic ...
 *   taskLoop.markRecoveryComplete(sessionID); // Resume auto-continuation
 *
 *   return {
 *     // Export loop controls for manual usage
 *     loops: {
 *       task: taskLoop,
 *       iteration: iterationLoop,
 *     },
 *   };
 * }
 * ```
 *
 * Advanced Usage - Combining Both Loops:
 *
 * ```typescript
 * // Use Iteration Loop for the overall task iteration
 * iterationLoop.startLoop(sessionID, "Implement feature X", {
 *   maxIterations: 10,
 *   completionMarker: "FEATURE_X_COMPLETE"
 * });
 *
 * // Task Loop will automatically continue sub-tasks within each iteration
 * // When all tasks are done, session goes idle
 * // Iteration Loop checks for completion marker
 * // If not found, starts next iteration
 * // If found, stops the loop
 * ```
 *
 * Completion Marker Format:
 *
 * ```
 * The agent should output this when complete:
 * <completion>DONE</completion>
 *
 * Or with custom marker:
 * <completion>CUSTOM_COMPLETION_TEXT</completion>
 * ```
 */
