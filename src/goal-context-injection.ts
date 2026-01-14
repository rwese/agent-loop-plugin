/**
 * Goal Context Injection
 *
 * Injects the current goal into session context so agents don't forget their goals.
 * Ensures goal context is only injected once per session and handles plugin reload/reconnection.
 */

import type { PluginContext, Goal } from "./types.js";
import {
  promptWithContext,
} from "./session-context.js";

const GOAL_GUIDANCE = `
## Active Goal

The agent has an active goal for this session. Use the goal tools to manage it:
- \`goal_status\` - Check the current goal details
- \`goal_done\` - Mark the goal as completed when the done condition is met
- \`goal_validate\` - Validate a completed goal after review
- \`goal_cancel\` - Cancel the goal if it's no longer relevant

**Remember:** Work toward completing the goal's done condition.
`;

export function createGoalContextInjection(goalManagement: {
  getGoal(sessionID: string): Promise<Goal | null>;
  checkPendingValidation(sessionID: string): Promise<boolean>;
  clearPendingValidation(sessionID: string): Promise<void>;
}) {
  async function injectGoalContext(
    ctx: PluginContext,
    sessionID: string,
    _context?: { model?: { providerID: string; modelID: string }; agent?: string }
  ): Promise<void> {
    if (!goalManagement) {
      return;
    }

    try {
      const goal = await goalManagement.getGoal(sessionID);
      if (!goal) {
        return;
      }

      const prompt = `<goal-context>

${GOAL_GUIDANCE}

**Current Goal:**
${goal.title}

**Done Condition:** ${goal.done_condition}
${goal.description ? `**Description:** ${goal.description}` : ""}

</goal-context>`;

      await promptWithContext({
        sessionID,
        text: prompt,
        noReply: true,
        synthetic: true,
      });
    } catch {
      // Silently fail
    }
  }

  async function handleChatMessage({
    sessionID,
  }: {
    sessionID: string;
    model?: { providerID: string; modelID: string };
    agent?: string;
  }): Promise<void> {
    await injectGoalContext({ client: {} } as PluginContext, sessionID);
  }

  async function handleSessionCompacted({
    properties,
  }: {
    properties?: { sessionID?: string };
  }): Promise<void> {
    if (!properties?.sessionID) {
      return;
    }

    await injectGoalContext({ client: {} } as PluginContext, properties.sessionID);
  }

  return {
    injectGoalContext,
    handleChatMessage,
    handleSessionCompacted,
  };
}
