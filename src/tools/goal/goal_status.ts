import { tool, type ToolContext } from "@opencode-ai/plugin/tool";
import { createGoalManagement } from "../../goal/management.js";

const DESCRIPTION = `Goal Status Tool

Use this tool to check the current goal status for the session. This provides a quick overview of what the agent should be working on.

**Usage:**
Simply call the tool without arguments to see the current goal:
\`\`\`
goal_status()
\`\`\`

**Returns:**
- Current goal title and description
- Status (active/in progress or completed)
- Done condition that defines success
- Creation timestamp
- Completion timestamp (if completed)

**Notes:**
- Returns "No active goal" if no goal is set
- Use this tool when unsure about the current objective
- Helpful for context switching or resuming sessions`;

export const goal_status = tool({
  description: DESCRIPTION,
  args: {},
  async execute(_args: Record<string, never>, context: ToolContext) {
    // Extract session ID from context
    const sessionID = (context as { sessionID?: string }).sessionID || "default";
    
    const gm = createGoalManagement({} as any, {});
    
    const goal = await gm.getGoal(sessionID);

    if (!goal) {
      return "📋 No active goal for this session.";
    }

    let statusText = "🟡 In Progress";
    if (goal.status === "completed") {
      statusText = "✅ Completed";
    } else if (goal.status === "validated") {
      statusText = "✓ Validated";
    }

    let completedText = "";
    if (goal.completed_at) {
      completedText = `\n**Completed:** ${new Date(goal.completed_at).toLocaleString()}`;
    }
    if (goal.validated_at) {
      completedText += `\n**Validated:** ${new Date(goal.validated_at).toLocaleString()}`;
    }

    return `🎯 **Current Goal:** ${goal.title}
${goal.description ? `**Description:** ${goal.description}` : ""}
**Status:** ${statusText}
**Done Condition:** ${goal.done_condition}
**Created:** ${new Date(goal.created_at).toLocaleString()}${completedText}`;
  },
});
