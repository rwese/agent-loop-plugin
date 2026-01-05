import { createTaskContinuation } from "./index.js"
export default function examplePlugin(ctx) {
  const taskContinuation = createTaskContinuation(ctx, {
    countdownSeconds: 3,
    errorCooldownMs: 5000,
    toastDurationMs: 1000,
  })
  const handleEvent = async (event) => {
    await taskContinuation.handler({ event })
  }
  return {
    pauseContinuation: (sessionID) => {
      taskContinuation.markRecovering(sessionID)
    },
    resumeContinuation: (sessionID) => {
      taskContinuation.markRecoveryComplete(sessionID)
    },
    cleanup: (sessionID) => {
      taskContinuation.cleanup(sessionID)
    },
    handleEvent,
    taskContinuation,
  }
}
export function example1_AutoTaskContinuation(ctx) {
  const plugin = examplePlugin(ctx)
  return plugin
}
export function example2_ErrorRecovery(ctx) {
  const plugin = examplePlugin(ctx)
  const handleError = async (event) => {
    const sessionID = event.properties?.sessionID
    if (!sessionID) return
    plugin.pauseContinuation(sessionID)
    await new Promise((resolve) => setTimeout(resolve, 5000))
    plugin.resumeContinuation(sessionID)
  }
  return { plugin, handleError }
}
export function example3_GracefulShutdown(ctx) {
  const plugin = examplePlugin(ctx)
  const cleanup = (sessionID) => {
    plugin.cleanup(sessionID)
  }
  return { plugin, cleanup }
}
//# sourceMappingURL=example.js.map
