/**
 * Agent Loop Plugin - Simplified Task Continuation
 *
 * A minimal single-file implementation that automatically continues sessions
 * when incomplete tasks remain.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createTaskContinuation, type Todo, type LoopEvent } from './agent-loop';
 *
 * export default function myPlugin(ctx: PluginContext) {
 *   const taskContinuation = createTaskContinuation(ctx, {
 *     countdownSeconds: 3,
 *     errorCooldownMs: 5000,
 *   });
 *
 *   ctx.on('event', taskContinuation.handler);
 *
 *   return { taskContinuation };
 * }
 * ```
 *
 * @module agent-loop-plugin
 */

// Export types from task-continuation (inlined, no separate types.ts)
export type {
  Todo,
  LoopEvent,
  TaskContinuation,
  TaskContinuationOptions,
} from "./task-continuation.js"

// Export the simplified task continuation plugin
export { createTaskContinuation } from "./task-continuation.js"
