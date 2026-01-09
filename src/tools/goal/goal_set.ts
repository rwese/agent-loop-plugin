import { tool, type ToolContext } from "@opencode-ai/plugin/tool";
import type { Goal } from "../../types.js";
import { createGoalManagement } from "../../goal/management.js";

const DESCRIPTION = `Goal Setting Tool

Use this tool to set a new goal for the current session. A goal helps the agent stay focused on the primary objective by defining what success looks like.

**Parameters:**
- \`title\`: A short, clear title for the goal (required)
- \`done_condition\`: Description of what constitutes goal completion (required)
- \`description\`: Optional detailed description of the goal (optional)

**Usage:**
Set a goal when starting a new task to keep the agent focused:
\`\`\`
goal_set(
  title="Fix login bug",
  done_condition="User can successfully log in with correct credentials",
  description="Investigate and fix the authentication issue preventing users from logging in"
)
\`\`\`

**Notes:**
- Only one active goal per session
- Use goal_done when the completion condition is met
- Use goal_cancel to abandon the current goal`;

export const goal_set = tool({
  description: DESCRIPTION,
  args: {
    title: tool.schema.string().describe("Short, clear title for the goal"),
    done_condition: tool.schema.string().describe("Description of what constitutes goal completion"),
    description: tool.schema.string().optional().describe("Optional detailed description of the goal"),
  },
  async execute(args: { title: string; done_condition: string; description?: string }, context: ToolContext) {
    // Extract session ID from context
    const sessionID = (context as { sessionID?: string }).sessionID || "default";
    
    const gm = createGoalManagement({} as any, {});
    
    await gm.createGoal(
      sessionID,
      args.title,
      args.done_condition,
      args.description
    );

    return `✅ Goal set successfully!

**Title:** ${args.title}
**Done Condition:** ${args.done_condition}
${args.description ? `**Description:** ${args.description}` : ""}

The agent will work toward this goal. Use goal_done when the condition is met.`;
  },
});
