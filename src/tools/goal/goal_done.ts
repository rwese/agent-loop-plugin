import { tool, type ToolContext } from "@opencode-ai/plugin/tool"
import type { PluginContext } from "../../types.js"
import { createGoalManagement } from "../../goal/management.js"
import { promptWithContext } from "../../session-context.js"

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

let pluginContext: PluginContext | null = null

export function setPluginContext(ctx: PluginContext) {
  pluginContext = ctx
}

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

    // Return completion message
    const completionMessage = `🎉 Goal completed!

**Title:** ${completedGoal.title}
**Completed At:** ${new Date(completedGoal.completed_at!).toLocaleString()}
${completedGoal.description ? `**Description:** ${completedGoal.description}` : ""}
**Done Condition:** ${completedGoal.done_condition}

The goal is now pending validation. An agent will review and validate it when the session becomes idle.

To validate, call: goal_validate()

Or set a new goal with: goal_set()`

    // Try to trigger validation prompt injection immediately if possible
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (context as any).client
      if (client?.session?.prompt && pluginContext) {
        // Get the goal for validation prompt
        const goalForValidation = await gm.getGoal(sessionID)
        if (goalForValidation && goalForValidation.status === "completed") {
          const validationPrompt = `## Goal Validation Required

The goal "${goalForValidation.title}" has been marked as completed.

**Please review and verify the done condition:**

**Done Condition:** ${goalForValidation.done_condition}
${goalForValidation.description ? `**Description:** ${goalForValidation.description}` : ""}

**Review Checklist:**
- ✅ Verify the done condition is satisfied
- ✅ Confirm the work meets requirements
- ✅ Ensure the goal is truly complete

**Your task:**
Call goal_validate() to validate this goal.

If not yet complete, you can:
- Set a new goal with goal_set()
- Continue working on this goal`

          // Try to inject validation prompt - may fail if session is busy, but that's OK
          await promptWithContext({
            sessionID,
            text: validationPrompt,
          })
          console.log("Validation prompt injected immediately after goal_done")
        }
      }
      } catch {
        // This is OK - validation will be triggered when session becomes idle
      }

    return completionMessage + "\n\n[TEST MARKER: goal_done executed successfully]"
  },
})
