/**
 * goal_validate Tool
 *
 * Validates a completed goal after agent approval.
 * The agent should review the goal and done criteria before validating.
 */

import { tool, type ToolContext } from "@opencode-ai/plugin/tool";
import { createGoalManagement } from "../../goal/management.js";

const DESCRIPTION = `Goal Validate Tool

Use this tool to validate a completed goal after agent review. The agent should verify the done condition is satisfied before validating.

**Usage:**
Call the tool to validate the current completed goal:
\`\`\`
goal_validate()
\`\`\`

**Preconditions:**
- Goal must be in "completed" status (use goal_done first)
- Agent should have reviewed the goal and verified the done condition

**Returns:**
- Validation confirmation
- Goal details including completion and validation timestamps

**Notes:**
- Only works on goals that are "completed"
- Use goal_status to review the goal before validating
- This is the final step in the goal lifecycle`;

export const goal_validate = tool({
  description: DESCRIPTION,
  args: {},
  async execute(_args: Record<string, never>, context: ToolContext) {
    // Extract session ID from context
    const sessionID = (context as { sessionID?: string }).sessionID || "default";
    
    const gm = createGoalManagement({} as any, {});

    // First get the goal to show validation context
    const goal = await gm.getGoal(sessionID);

    if (!goal) {
      return "⚠️ No goal exists for this session to validate.";
    }

    if (goal.status === "active") {
      return "⚠️ The goal is still active. Use goal_done to mark it as completed first.";
    }

    if (goal.status === "validated") {
      return "⚠️ The goal has already been validated.";
    }

    if (goal.status !== "completed") {
      return "⚠️ Goal must be completed before it can be validated.";
    }

    // Validate the goal
    const validatedGoal = await gm.validateGoal(sessionID);

    if (!validatedGoal) {
      return "⚠️ Failed to validate goal. Please try again.";
    }

    return `✅ Goal validated!

**Title:** ${validatedGoal.title}
**Status:** Validated
**Completed:** ${new Date(validatedGoal.completed_at!).toLocaleString()}
**Validated:** ${new Date(validatedGoal.validated_at!).toLocaleString()}
${validatedGoal.description ? `**Description:** ${validatedGoal.description}` : ""}
**Done Condition:** ${validatedGoal.done_condition}

The goal has been successfully validated and is now complete.`;
  },
});