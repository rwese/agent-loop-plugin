import { type LoopEvent } from "./index.js"
export default function examplePlugin(ctx: any): {
  pauseContinuation: (sessionID: string) => void
  resumeContinuation: (sessionID: string) => void
  cleanup: (sessionID: string) => void
  handleEvent: (event: LoopEvent) => Promise<void>
  taskContinuation: import("./task-continuation.js").TaskContinuation
}
export declare function example1_AutoTaskContinuation(ctx: any): {
  pauseContinuation: (sessionID: string) => void
  resumeContinuation: (sessionID: string) => void
  cleanup: (sessionID: string) => void
  handleEvent: (event: LoopEvent) => Promise<void>
  taskContinuation: import("./task-continuation.js").TaskContinuation
}
export declare function example2_ErrorRecovery(ctx: any): {
  plugin: {
    pauseContinuation: (sessionID: string) => void
    resumeContinuation: (sessionID: string) => void
    cleanup: (sessionID: string) => void
    handleEvent: (event: LoopEvent) => Promise<void>
    taskContinuation: import("./task-continuation.js").TaskContinuation
  }
  handleError: (event: LoopEvent) => Promise<void>
}
export declare function example3_GracefulShutdown(ctx: any): {
  plugin: {
    pauseContinuation: (sessionID: string) => void
    resumeContinuation: (sessionID: string) => void
    cleanup: (sessionID: string) => void
    handleEvent: (event: LoopEvent) => Promise<void>
    taskContinuation: import("./task-continuation.js").TaskContinuation
  }
  cleanup: (sessionID: string) => void
}
//# sourceMappingURL=example.d.ts.map
