/**
 * Agent Loop Plugin - Simplified Task Continuation
 *
 * A minimal single-file implementation that automatically continues sessions
 * when incomplete tasks remain.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createTaskContinuation } from './agent-loop';
 * import type { PluginContext } from './agent-loop';
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

// Export types
export type { PluginContext, Todo, LoopEvent } from "./types.js"

// Export the simplified task continuation plugin
export { createTaskContinuation } from "./task-continuation.js"
export type { TaskContinuation, TaskContinuationOptions } from "./task-continuation.js"
