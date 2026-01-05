/**
 * OpenCode Plugin Entry Point
 *
 * Exposes the task continuation plugin for use in OpenCode.
 *
 * @example
 * ```typescript
 * import taskContinuation from "./plugin/index.js"
 *
 * export default function myPlugin(ctx) {
 *   const tc = taskContinuation(ctx, {
 *     countdownSeconds: 3,
 *     errorCooldownMs: 5000,
 *   })
 *
 *   ctx.on("event", tc.handler)
 *
 *   return { taskContinuation: tc }
 * }
 * ```
 */

export { default as default, createTaskContinuation } from "./taskcontinuation.js"
