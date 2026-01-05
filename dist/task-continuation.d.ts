import type { PluginContext, LoopEvent } from "./types.js"
export interface TaskContinuationOptions {
  countdownSeconds?: number
  errorCooldownMs?: number
  toastDurationMs?: number
  agent?: string
  model?: string
}
export interface TaskContinuation {
  handler: (input: { event: LoopEvent }) => Promise<void>
  markRecovering: (sessionID: string) => void
  markRecoveryComplete: (sessionID: string) => void
  cleanup: (sessionID: string) => void
}
export declare function createTaskContinuation(
  ctx: PluginContext,
  options?: TaskContinuationOptions
): TaskContinuation
export type { PluginContext, Todo, LoopEvent } from "./types.js"
//# sourceMappingURL=task-continuation.d.ts.map
