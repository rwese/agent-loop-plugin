import { createTaskContinuation } from "./task-continuation.js"
const mockContext = {
  directory: "/test",
  client: {
    session: {
      todo: async () => [
        { id: "1", content: "Task 1", status: "pending", priority: "high" },
        { id: "2", content: "Task 2", status: "in_progress", priority: "high" },
      ],
      get: async () => ({
        id: "ses_test",
        title: "Test Session",
        directory: "/test",
      }),
      messages: async () => [
        {
          info: {
            id: "msg_1",
            sessionID: "ses_test",
            role: "user",
            agent: "builder",
            model: { providerID: "anthropic", modelID: "claude-3-5-sonnet-20241022" },
          },
          parts: [],
        },
        {
          info: {
            id: "msg_2",
            sessionID: "ses_test",
            role: "assistant",
          },
          parts: [],
        },
      ],
      prompt: async () => {
        console.log("✅ session.prompt called successfully")
      },
    },
    tui: {
      showToast: async () => {
        console.log("✅ Toast shown")
      },
    },
  },
}
async function test() {
  console.log("Testing session.messages() API...")
  const taskContinuation = createTaskContinuation(mockContext, {
    countdownSeconds: 1,
    logFilePath: "/Users/wese/Repos/OC_agent/agent-loop/test-debug.log",
  })
  await taskContinuation.handler({
    event: {
      type: "session.idle",
      properties: { sessionID: "ses_test" },
    },
  })
  console.log("Test complete - check /Users/wese/Repos/OC_agent/agent-loop/test-debug.log")
}
test().catch(console.error)
//# sourceMappingURL=test-messages-api.js.map
