import { createTaskContinuation } from "./index.js"
export default function examplePlugin(ctx) {
  const taskContinuation = createTaskContinuation(ctx, {})
  const handleEvent = async (event) => {
    await taskContinuation.handler({ event })
  }
  return {
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
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  return { plugin, handleError }
}
export function example3_GracefulShutdown(ctx) {
  const plugin = examplePlugin(ctx)
  return { plugin }
}
//# sourceMappingURL=example.js.map
