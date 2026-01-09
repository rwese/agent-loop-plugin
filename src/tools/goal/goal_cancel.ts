import { tool, type ToolContext } from "@opencode-ai/plugin/tool";
import { createGoalManagement } from "../../goal/management.js";

const DESCRIPTION = `Goal Cancellation Tool

Use this tool to cancel or abandon the current goal without completing it. This is useful when the goal is no longer relevant or needs to be redefined.

**Parameters:**
- \`reason\`: Optional explanation for why the goal is being cancelled (optional)

**Usage:**
Cancel the current goal:
\`\`\`
goal_cancel(reason="Requirements changed, need to reassess")
\`\`\`

**What happens:**
- Current goal is marked as completed (cancelled state)
- Cancellation reason is recorded if provided
- Goal is removed from active tracking

**Notes:**
- Only works if there's an active goal
- Provide a reason for better tracking and context
- Consider setting a new goal after cancellation
- Unlike goal_done, this indicates the goal wasn't fully achieved`;

export const goal_cancel = tool({
  description: DESCRIPTION,
  args: {
    reason: tool.schema.string().optional().describe("Explanation for why the goal is being cancelled"),
  },
  async execute(args: { reason?: string }, context: ToolContext) {
    // Extract session ID from context
    const sessionID = (context as { sessionID?: string }).sessionID || "default";
    
    const gm = createGoalManagement({} as any, {});
    
    const goal = await gm.getGoal(sessionID);

    if (!goal) {
      return "⚠️ No active goal to cancel.";
    }

    await gm.completeGoal(sessionID);

    const reasonText = args.reason ? `\n**Reason:** ${args.reason}` : "";
    return `🚫 Goal cancelled.

**Title:** ${goal.title}${reasonText}
The goal has been removed.`;
  },
});
