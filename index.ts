/**
 * Agent Loop Plugin - OpenCode Integration
 *
 * Provides agent loop mechanisms for OpenCode plugins including:
 * - Task Loop: Automatically continues sessions when incomplete tasks remain
 * - Iteration Loop: Continues iteration until completion signal is received
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

// Export types from types module
export type {
  Todo,
  LoopEvent,
  TaskContinuationOptions,
  PluginContext,
  ModelSpec,
  PromptPart,
  SessionInfo,
  MessageInfo,
  IterationLoopState,
  CompleteLoopResult,
  AdvisorEvaluationResult,
  CompletionEvaluatorInfo,
  LogLevel,
  CountdownCallbackInfo,
  IterationLoopOptions,
  TaskLoopOptions,
} from "./types.js"

// Export the task continuation implementation
export { createTaskContinuation } from "./task-continuation.js"

// Export the plugin
export { default as agentLoopPlugin, createAgentLoopPlugin } from "./plugin.js"
