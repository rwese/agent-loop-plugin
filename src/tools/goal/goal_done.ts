import { tool, type ToolContext } from "@opencode-ai/plugin/tool";
import { createGoalManagement } from "../../goal/management.js";

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
- Consider setting a new goal after completion`;

export const goal_done = tool({
  description: DESCRIPTION,
  args: {},
  async execute(_args: Record<string, never>, context: ToolContext) {
    // Extract session ID from context
    const sessionID = (context as { sessionID?: string }).sessionID || "default";
    
    const gm = createGoalManagement({} as any, {});
    
    const completedGoal = await gm.completeGoal(sessionID);

    if (!completedGoal) {
      return "⚠️ No active goal to complete. Use goal_set first.";
    }

    return `🎉 Goal completed!

**Title:** ${completedGoal.title}
**Completed At:** ${new Date(completedGoal.completed_at!).toLocaleString()}
${completedGoal.description ? `**Description:** ${completedGoal.description}` : ""}
**Done Condition:** ${completedGoal.done_condition}

## Goal Validation Required

The goal has been marked as completed, but requires validation to confirm the done condition has been met.

**Please review:**
- Have you verified the done condition is satisfied?
- Does the work meet the requirements?
- Is the goal truly complete?

**To validate this goal**, call: goal_validate()

If the done condition is not yet met, you can:
- Set a new goal with goal_set()
- Continue working on the current goal`;
  },
});
