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
  const sessions = new Map()
  function getState(sessionID) {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }
  function cancelCountdown(sessionID) {
    const state = sessions.get(sessionID)
    if (!state) return
    if (state.countdownTimer) clearTimeout(state.countdownTimer)
    if (state.countdownInterval) clearInterval(state.countdownInterval)
    state.countdownTimer = undefined
    state.countdownInterval = undefined
  }
  function cleanup(sessionID) {
    cancelCountdown(sessionID)
    sessions.delete(sessionID)
  }
  async function showToast(title, message, variant) {
    await ctx.client.tui
      .showToast({ body: { title, message, variant, duration: toastDurationMs } })
      .catch(() => {})
  }
  async function sendStatus(sessionID, text) {
    try {
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent,
          model,
          noReply: true,
          parts: [{ type: "text", text, ignored: true }],
        },
        query: { directory: ctx.directory },
      })
    } catch {}
  }
  async function fetchTodos(sessionID) {
    try {
      const response = await ctx.client.session.todo({ path: { id: sessionID } })
      return Array.isArray(response) ? response : (response.data ?? [])
    } catch {
      return []
    }
  }
  function isInCooldown(sessionID) {
    const state = sessions.get(sessionID)
    if (state?.isRecovering) return true
    if (state?.lastErrorAt && Date.now() - state.lastErrorAt < errorCooldownMs) return true
    return false
  }
  async function injectContinuation(sessionID) {
    if (isInCooldown(sessionID)) return
    const todos = await fetchTodos(sessionID)
    const incompleteCount = getIncompleteCount(todos)
    if (incompleteCount === 0) return
    const prompt = buildContinuationPrompt(todos)
    try {
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: { agent, model, parts: [{ type: "text", text: prompt }] },
        query: { directory: ctx.directory },
      })
    } catch {}
  }
  async function startCountdown(sessionID, incompleteCount, _total) {
    const state = getState(sessionID)
    if (state.countdownTimer) cancelCountdown(sessionID)
    await showToast(
      "Task Continuation",
      `${incompleteCount} incomplete task(s). Continuing in ${countdownSeconds}s...`,
      "info"
    )
    let secondsLeft = countdownSeconds
    state.countdownInterval = setInterval(async () => {
      secondsLeft--
      if (secondsLeft > 0) {
        await showToast(
          "Task Continuation",
          `${incompleteCount} incomplete task(s). Continuing in ${secondsLeft}s...`,
          "info"
        )
      }
    }, 1000)
    state.countdownTimer = setTimeout(async () => {
      cancelCountdown(sessionID)
      await injectContinuation(sessionID)
    }, countdownSeconds * 1000)
  }
  const handleSessionIdle = async (sessionID) => {
    if (isInCooldown(sessionID)) return
    const todos = await fetchTodos(sessionID)
    const state = getState(sessionID)
    const incompleteCount = getIncompleteCount(todos)
    if (incompleteCount === 0) {
      if (!state.completionShown) {
        state.completionShown = true
        await sendStatus(sessionID, `✅ All ${todos.length} tasks completed!`)
      }
      return
    }
    state.completionShown = false
    await startCountdown(sessionID, incompleteCount, todos.length)
  }
  const handleSessionError = (sessionID) => {
    const state = getState(sessionID)
    state.lastErrorAt = Date.now()
    cancelCountdown(sessionID)
  }
  const handleUserMessage = (sessionID) => {
    const state = sessions.get(sessionID)
    if (state) {
      state.lastErrorAt = undefined
      if (state.countdownTimer) cancelCountdown(sessionID)
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
      case "session.error":
        handleSessionError(sessionID)
        break
      case "session.idle":
        await handleSessionIdle(sessionID)
        break
      case "message.updated":
        if (event.properties?.info?.role === "user") handleUserMessage(sessionID)
        break
      case "session.deleted":
        cleanup(sessionID)
        break
    }
  }
  const markRecovering = (sessionID) => {
    const state = getState(sessionID)
    state.isRecovering = true
    cancelCountdown(sessionID)
  }
  const markRecoveryComplete = (sessionID) => {
    const state = sessions.get(sessionID)
    if (state) state.isRecovering = false
  }
  return { handler, markRecovering, markRecoveryComplete, cleanup }
}
//# sourceMappingURL=task-continuation.js.map
