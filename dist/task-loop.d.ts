import type { PluginContext, LoopEvent, TaskLoopOptions } from "./types.js"
export interface TaskLoop {
  handler: (input: { event: LoopEvent }) => Promise<void>
  markRecovering: (sessionID: string) => void
  markRecoveryComplete: (sessionID: string) => void
  cleanup: (sessionID: string) => void
}
export declare function createTaskLoop(ctx: PluginContext, options?: TaskLoopOptions): TaskLoop
//# sourceMappingURL=task-loop.d.ts.map
