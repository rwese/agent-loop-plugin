import { type LoopEvent, type PluginContext } from "./index.js"
export default function examplePlugin(ctx: PluginContext): {
  handleEvent: (event: LoopEvent) => Promise<void>
  taskContinuation: import("./task-continuation.js").TaskContinuation
}
export declare function example1_AutoTaskContinuation(ctx: PluginContext): {
  handleEvent: (event: LoopEvent) => Promise<void>
  taskContinuation: import("./task-continuation.js").TaskContinuation
}
export declare function example2_ErrorRecovery(ctx: PluginContext): {
  plugin: {
    handleEvent: (event: LoopEvent) => Promise<void>
    taskContinuation: import("./task-continuation.js").TaskContinuation
  }
  handleError: (event: LoopEvent) => Promise<void>
}
export declare function example3_GracefulShutdown(ctx: PluginContext): {
  plugin: {
    handleEvent: (event: LoopEvent) => Promise<void>
    taskContinuation: import("./task-continuation.js").TaskContinuation
  }
}
//# sourceMappingURL=example.d.ts.map
