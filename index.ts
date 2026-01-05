/**
 * Agent Loop - Task continuation and iteration loops for OpenCode plugins
 *
 * This module provides two complementary agent loop mechanisms:
 *
 * 1. **Task Loop**: Automatically continues sessions when incomplete tasks remain
 * 2. **Iteration Loop**: Iteration-based loop that continues until completion marker is detected
 *
 * Both loops work with any OpenCode plugin context and are designed to be:
 * - Minimal dependencies (Node.js built-ins only)
 * - Event-driven
 * - Configurable
 * - Type-safe
 *
 * ## Quick Start
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
 *   return {
 *     loops: {
 *       task: taskLoop,
 *       iteration: iterationLoop,
 *     },
 *   };
 * }
 * ```
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
  CountdownCallbackInfo,
  Logger,
  LogLevel,
  CompleteLoopResult,
  AdvisorEvaluationResult,
  CompletionEvaluatorInfo,
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
  generateCodename,
} from "./utils.js"

export type { SendIgnoredMessageOptions } from "./utils.js"
