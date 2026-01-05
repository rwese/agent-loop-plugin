const getIncompleteTodos = (todos) =>
  todos.filter((t) => t.status !== "completed" && t.status !== "cancelled")
const getIncompleteCount = (todos) => getIncompleteTodos(todos).length
function buildContinuationPrompt(todos) {
  const pending = getIncompleteTodos(todos)
  return `[SYSTEM - AUTO-CONTINUATION]

You have ${pending.length} incomplete task(s). Work on them NOW without asking for permission.

PENDING TASKS:

${pending.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`).join("\n")}

INSTRUCTIONS:

1. Pick the next pending task and execute it immediately
2. Use todowrite to mark it "in_progress" then "completed" when done
3. Continue until all tasks are complete
4. MUST work independently - you can solve everything without asking for permission.`
}
export function createTaskContinuation(ctx, options = {}) {
  const {
    countdownSeconds = 2,
    errorCooldownMs = 3000,
    toastDurationMs = 900,
    agent,
    model,
  } = options
  const recoveringSessions = new Set()
  const errorCooldowns = new Map()
  const pendingCountdowns = new Map()
  const sessionAgentModel = new Map()
  async function fetchTodos(sessionID) {
    try {
      const response = await ctx.client.session.todo({ path: { id: sessionID } })
      return Array.isArray(response) ? response : (response.data ?? [])
    } catch {
      return []
    }
  }
  function updateSessionAgentModel(sessionID, eventAgent, eventModel) {
    if (eventAgent || eventModel) {
      sessionAgentModel.set(sessionID, {
        agent: eventAgent,
        model: eventModel,
      })
    }
  }
  function getAgentModel(sessionID) {
    const tracked = sessionAgentModel.get(sessionID)
    if (tracked && (tracked.agent || tracked.model)) {
      return tracked
    }
    return { agent, model }
  }
  async function injectContinuation(sessionID) {
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }
    const todos = await fetchTodos(sessionID)
    const incompleteCount = getIncompleteCount(todos)
    if (incompleteCount === 0) return
    const prompt = buildContinuationPrompt(todos)
    const { agent: continuationAgent, model: continuationModel } = getAgentModel(sessionID)
    try {
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: continuationAgent,
          model: continuationModel,
          parts: [{ type: "text", text: prompt }],
        },
        query: { directory: ctx.directory },
      })
    } catch {}
  }
  async function scheduleContinuation(sessionID) {
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }
    const timeout = setTimeout(() => {
      pendingCountdowns.delete(sessionID)
      injectContinuation(sessionID)
    }, countdownSeconds * 1000)
    pendingCountdowns.set(sessionID, timeout)
    try {
      await ctx.client.tui.showToast({
        body: {
          title: "Auto-Continuing",
          message: `Continuing in ${countdownSeconds} seconds...`,
          variant: "info",
          duration: toastDurationMs,
        },
      })
    } catch {}
  }
  const handleSessionIdle = async (sessionID) => {
    if (recoveringSessions.has(sessionID)) {
      return
    }
    const lastError = errorCooldowns.get(sessionID) ?? 0
    if (Date.now() - lastError < errorCooldownMs) {
      return
    }
    const todos = await fetchTodos(sessionID)
    const incompleteCount = getIncompleteCount(todos)
    if (incompleteCount === 0) {
      const { agent: completionAgent, model: completionModel } = getAgentModel(sessionID)
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: completionAgent,
          model: completionModel,
          noReply: true,
          parts: [{ type: "text", text: "All tasks completed!", ignored: true }],
        },
        query: { directory: ctx.directory },
      })
      return
    }
    scheduleContinuation(sessionID)
  }
  const handleSessionError = async (sessionID) => {
    errorCooldowns.set(sessionID, Date.now())
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }
  }
  const handleUserMessage = async (sessionID, event) => {
    errorCooldowns.delete(sessionID)
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }
    if (event?.properties?.info) {
      const info = event.properties.info
      const messageAgent = info.agent
      const messageModel = info.model
      if (messageAgent || messageModel) {
        updateSessionAgentModel(sessionID, messageAgent, messageModel)
      }
    }
  }
  const handleSessionDeleted = async (sessionID) => {
    recoveringSessions.delete(sessionID)
    errorCooldowns.delete(sessionID)
    sessionAgentModel.delete(sessionID)
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }
  }
  function extractSessionID(event) {
    const props = event.properties
    if (props?.sessionID && typeof props.sessionID === "string") return props.sessionID
    if (props?.info?.sessionID && typeof props.info.sessionID === "string")
      return props.info.sessionID
    if (props?.info?.id && typeof props.info.id === "string") return props.info.id
    return undefined
  }
  const handler = async ({ event }) => {
    const sessionID = extractSessionID(event)
    if (!sessionID) return
    switch (event.type) {
      case "session.idle":
        await handleSessionIdle(sessionID)
        break
      case "session.error":
        await handleSessionError(sessionID)
        break
      case "message.updated":
        await handleUserMessage(sessionID, event)
        break
      case "session.deleted":
        await handleSessionDeleted(sessionID)
        break
    }
  }
  const markRecovering = (sessionID) => {
    recoveringSessions.add(sessionID)
  }
  const markRecoveryComplete = (sessionID) => {
    recoveringSessions.delete(sessionID)
  }
  const cancel = (sessionID) => {
    const existingTimeout = pendingCountdowns.get(sessionID)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
      pendingCountdowns.delete(sessionID)
    }
    errorCooldowns.delete(sessionID)
    recoveringSessions.delete(sessionID)
  }
  const cleanup = async () => {
    for (const timeout of pendingCountdowns.values()) {
      clearTimeout(timeout)
    }
    pendingCountdowns.clear()
    recoveringSessions.clear()
    errorCooldowns.clear()
    sessionAgentModel.clear()
  }
  return {
    handler,
    markRecovering,
    markRecoveryComplete,
    cancel,
    cleanup,
  }
}
//# sourceMappingURL=task-continuation.js.map
