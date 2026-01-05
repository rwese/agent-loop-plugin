import { type LoopEvent } from "./index.js"
export default function examplePlugin(ctx: any): {
  handleEvent: (event: LoopEvent) => Promise<void>
  taskContinuation: import("./task-continuation.js").TaskContinuation
}
export declare function example1_AutoTaskContinuation(ctx: any): {
  handleEvent: (event: LoopEvent) => Promise<void>
  taskContinuation: import("./task-continuation.js").TaskContinuation
}
export declare function example2_ErrorRecovery(ctx: any): {
  plugin: {
    handleEvent: (event: LoopEvent) => Promise<void>
    taskContinuation: import("./task-continuation.js").TaskContinuation
  }
  handleError: (event: LoopEvent) => Promise<void>
}
export declare function example3_GracefulShutdown(ctx: any): {
  plugin: {
    handleEvent: (event: LoopEvent) => Promise<void>
    taskContinuation: import("./task-continuation.js").TaskContinuation
  }
}
//# sourceMappingURL=example.d.ts.map
