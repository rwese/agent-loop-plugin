import { tool, type ToolContext } from "@opencode-ai/plugin/tool"
import { createGoalManagement } from "../../goal/management.js"

const DESCRIPTION = `Goal Completion Tool

Use this tool to mark the current goal as successfully completed. This signals that the done condition has been met and the objective has been achieved.

**Usage:**
Call when the goal's completion criteria are satisfied:
\`\`\`
goal_done()
\`\`\`

**What happens:**
- Current goal status changes from "active" to "completed"
- Completion timestamp is recorded
- Goal remains visible but marked as done

**Notes:**
- Only works if there's an active goal
- Use this to formally close out a goal
- The completed goal can still be viewed via goal_status
- Consider setting a new goal after completion`

export const goal_done = tool({
  description: DESCRIPTION,
  args: {},
  async execute(_args: Record<string, never>, context: ToolContext) {
    // Extract session ID from context
    const sessionID = (context as { sessionID?: string }).sessionID || "default"

    const gm = createGoalManagement({} as any, {})

    const completedGoal = await gm.completeGoal(sessionID)

    if (!completedGoal) {
      return "⚠️ No active goal to complete. Use goal_set first."
    }

    // Return completion message first
    const completionMessage = `🎉 Goal completed!

**Title:** ${completedGoal.title}
**Completed At:** ${new Date(completedGoal.completed_at!).toLocaleString()}
${completedGoal.description ? `**Description:** ${completedGoal.description}` : ""}
**Done Condition:** ${completedGoal.done_condition}`

    // Create validation prompt for the agent
    const validationPrompt = `## Goal Validation Required

The goal "${completedGoal.title}" has been marked as completed.

**Please review the goal and verify the done condition:**

**Done Condition:** ${completedGoal.done_condition}
${completedGoal.description ? `**Description:** ${completedGoal.description}` : ""}

**Review Checklist:**
- ✅ Verify the done condition is satisfied
- ✅ Confirm the work meets the requirements
- ✅ Ensure the goal is truly complete

**Your next step:**
If the done condition is satisfied, please validate this goal by calling: \`goal_validate()\`

If the done condition is not yet met, you can:
- Set a new goal with \`goal_set()\`
- Continue working on the current goal`

    // Try to prompt the agent for validation
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (context as any).client
      console.log("🔍 Client object keys:", client ? Object.keys(client) : "client is undefined")
      console.log("🔍 Client type:", typeof client)
      
      if (client?.session) {
        console.log("🔍 Session object keys:", Object.keys(client.session))
      }
      
      if (client?.session?.prompt) {
        await client.session.prompt({
          path: { id: sessionID },
          body: {
            agent: context.agent,
            parts: [{ type: "text", text: validationPrompt, synthetic: true }],
          },
        })
        console.log("✅ Validation prompt injected successfully for session:", sessionID)
      } else {
        console.warn("⚠️ client.session.prompt not available")
        console.warn("🔍 Available in client:", client?.session ? Object.keys(client.session) : "no session")
      }
    } catch (error) {
      console.error("❌ Failed to inject validation prompt:", error)
    }

    return completionMessage
  },
})
