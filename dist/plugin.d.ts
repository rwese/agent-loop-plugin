import type { LoopEvent, PluginContext } from "./types.js"
export interface AgentLoopPluginOptions {
  taskLoop?: boolean
  iterationLoop?: boolean
  countdownSeconds?: number
  errorCooldownMs?: number
  toastDurationMs?: number
  agent?: string
  model?: string
  debug?: boolean
  logFilePath?: string
}
export declare function createAgentLoopPlugin(options?: AgentLoopPluginOptions): (
  ctx: PluginContext
) => Promise<{
  event: ({ event }: { event: LoopEvent }) => Promise<void>
  config: (_opencodeConfig: Record<string, unknown>) => Promise<void>
  cleanup: () => Promise<void>
}>
declare const plugin: (ctx: PluginContext) => Promise<{
  event: ({ event }: { event: LoopEvent }) => Promise<void>
  config: (_opencodeConfig: Record<string, unknown>) => Promise<void>
  cleanup: () => Promise<void>
}>
export default plugin
export type {
  Todo,
  LoopEvent,
  TaskContinuationOptions,
  PluginContext,
  ModelSpec,
  PromptPart,
  SessionInfo,
  MessageInfo,
  LogLevel,
  CountdownCallbackInfo,
  TaskLoopOptions,
} from "./types.js"
export { createTaskContinuation } from "./task-continuation.js"
//# sourceMappingURL=plugin.d.ts.map
