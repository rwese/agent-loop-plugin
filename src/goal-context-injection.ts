/**
 * Goal Context Injection
 *
 * Injects the current goal into session context so agents don't forget their goals.
 * Ensures goal context is only injected once per session and handles plugin reload/reconnection.
 */

import type { PluginContext, Goal } from "./types.js";
import { createLogger } from "./logger.js";

const log = createLogger("goal-context-injection");

const GOAL_GUIDANCE = `
## Active Goal

The agent has an active goal for this session. Use the goal tools to manage it:
- \`goal_status\` - Check the current goal details
- \`goal_done\` - Mark the goal as completed when the done condition is met
- \`goal_validate\` - Validate a completed goal after review
- \`goal_cancel\` - Cancel the goal if it's no longer relevant

**Remember:** Work toward completing the goal's done condition.
`;

const VALIDATION_GUIDANCE = `
## Goal Validation Required

This goal has been marked as completed. Please review and validate it.

**Review Checklist:**
- ✅ Verify the done condition is satisfied
- ✅ Confirm the work meets requirements  
- ✅ Ensure the goal is truly complete

**To Validate:**
Call: \`goal_validate()\`

If not yet complete, you can:
- Set a new goal with \`goal_set()\`
- Continue working on this goal
`;

/**
 * Check if goal context was already injected in a session
 */
async function hasGoalContext(
  client: PluginContext["client"],
  sessionID: string
): Promise<boolean> {
  try {
    const existing = await client.session.messages({
      path: { id: sessionID },
    });

    if (existing.data) {
      const messages = existing.data as Array<{ parts?: unknown[]; info?: { parts?: unknown[] } }>;
      return messages.some((msg) => {
        const parts = (msg as any).parts || (msg.info as any).parts;
        if (!parts) return false;
        return (parts as Array<{ type?: string; text?: string }>).some(
          (part) => part.type === "text" && part.text?.includes("<goal-context>")
        );
      });
    }
  } catch {
    // On error, assume no goal context exists
  }
  return false;
}

/**
 * Get session context information (model and agent)
 */
async function getSessionContext(
  client: PluginContext["client"],
  sessionID: string
): Promise<{ model?: { providerID: string; modelID: string }; agent?: string } | undefined> {
  try {
    const session = await client.session.get({ path: { id: sessionID } });
    if (session.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = session.data as any;
      const model = data.model;
      return {
        model:
          typeof model === "string"
            ? undefined
            : model
              ? { providerID: model.providerID || "unknown", modelID: model.modelID || "unknown" }
              : undefined,
        agent: data.agent,
      };
    }
  } catch {
    // Silently fail if we can't get session context
  }
  return undefined;
}

/**
 * Format goal for injection into context
 */
function formatGoalContext(goal: Goal): string {
  return `<goal-context>
${goal.title}
${goal.description ? `Description: ${goal.description}` : ""}
Done Condition: ${goal.done_condition}
Status: ${goal.status}
</goal-context>

${GOAL_GUIDANCE}`;
}

/**
 * Inject goal context into a session.
 *
 * Gets the current goal and injects it along with guidance.
 * Silently skips if no goal exists for the session.
 */
export async function injectGoalContext(
  ctx: PluginContext,
  sessionID: string,
  context?: { model?: { providerID: string; modelID: string }; agent?: string }
): Promise<void> {
  try {
    // Get goal management instance
    const gm = await getGoalManagement(ctx);
    if (!gm) return;

    // Get the current goal for this session
    const goal = await gm.getGoal(sessionID);

    if (!goal) {
      return;
    }

    const goalContext = formatGoalContext(goal);

    // Get session context if not provided
    const sessionContext = context || (await getSessionContext(ctx.client, sessionID));

    // Inject content via noReply + synthetic
    // Must pass model and agent to prevent mode/model switching
    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: {
        noReply: true,
        model: sessionContext?.model,
        agent: sessionContext?.agent,
        parts: [{ type: "text", text: goalContext, synthetic: true }],
      },
    });
  } catch {
    // Silent skip if goal injection fails
  }
}

// Lazy-loaded goal management to avoid circular dependencies
let goalManagementInstance: ReturnType<typeof import("./goal/management.js").createGoalManagement> | null = null;

async function getGoalManagement(ctx: PluginContext): Promise<ReturnType<typeof import("./goal/management.js").createGoalManagement> | null> {
  if (!goalManagementInstance) {
    const mod = await import("./goal/management.js");
    goalManagementInstance = mod.createGoalManagement(ctx, {});
  }
  return goalManagementInstance;
}

/**
 * Check if validation prompt was already injected in a session
 */
async function hasValidationPrompt(
  client: PluginContext["client"],
  sessionID: string
): Promise<boolean> {
  try {
    const existing = await client.session.messages({
      path: { id: sessionID },
    });

    if (existing.data) {
      const messages = existing.data as Array<{ parts?: unknown[]; info?: { parts?: unknown[] } }>;
      return messages.some((msg) => {
        const parts = (msg as any).parts || (msg.info as any).parts;
        if (!parts) return false;
        return (parts as Array<{ type?: string; text?: string }>).some(
          (part) => part.type === "text" && part.text?.includes("<goal-validation-prompt>")
        );
      });
    }
  } catch {
    // On error, assume no validation prompt exists
  }
  return false;
}

/**
 * Inject validation prompt for a completed goal
 */
export async function injectValidationPrompt(
  ctx: PluginContext,
  sessionID: string
): Promise<void> {
  try {
    // Get goal management to get the completed goal
    const gm = await getGoalManagement(ctx);
    if (!gm) {
      log.warn("Goal management not available for validation prompt injection");
      return;
    }

    const goal = await gm.getGoal(sessionID);
    if (!goal || goal.status !== "completed") {
      log.debug("No completed goal found for validation prompt", { sessionID, goalStatus: goal?.status });
      return;
    }

    // Check if validation prompt was already injected
    const hasPrompt = await hasValidationPrompt(ctx.client, sessionID);
    if (hasPrompt) {
      log.debug("Validation prompt already injected", { sessionID });
      return;
    }

    const validationPrompt = `<goal-validation-prompt>
## Goal Validation Required

The goal "${goal.title}" has been marked as completed.

**Done Condition:** ${goal.done_condition}
${goal.description ? `**Description:** ${goal.description}` : ""}

**Please review and validate this goal.**

**Review Checklist:**
- ✅ Verify the done condition is satisfied
- ✅ Confirm the work meets requirements  
- ✅ Ensure the goal is truly complete

**To Validate:**
Call: \`goal_validate()\`

If not yet complete, you can:
- Set a new goal with \`goal_set()\`
- Continue working on this goal
</goal-validation-prompt>`;

    // Get session context to preserve model and agent
    const sessionContext = await getSessionContext(ctx.client, sessionID);

    log.debug("Injecting validation prompt", {
      sessionID,
      goalTitle: goal.title,
      hasModel: !!sessionContext?.model,
      hasAgent: !!sessionContext?.agent,
    });

    // Inject validation prompt via noReply + synthetic
    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: {
        noReply: true,
        model: sessionContext?.model,
        agent: sessionContext?.agent,
        parts: [{ type: "text", text: validationPrompt, synthetic: true }],
      },
    });

    log.info("Validation prompt injected successfully", { sessionID, goalTitle: goal.title });
  } catch (error) {
    log.error("Failed to inject validation prompt", { sessionID, error });
    throw error; // Re-throw to trigger retry
  }
}

/**
 * Create goal context injection handler
 */
export function createGoalContextInjection(ctx: PluginContext) {
  const injectedSessions = new Set<string>();

  return {
    /**
     * Handle chat message events to inject goal context
     */
    handleChatMessage: async (input: {
      sessionID: string;
      model?: { providerID: string; modelID: string };
      agent?: string;
    }) => {
      const sessionID = input.sessionID;

      // Skip if already injected this session
      if (injectedSessions.has(sessionID)) return;

      // Check if goal-context was already injected (handles plugin reload/reconnection)
      const hasContext = await hasGoalContext(ctx.client, sessionID);
      if (hasContext) {
        injectedSessions.add(sessionID);
        return;
      }

      injectedSessions.add(sessionID);

      const gm = await getGoalManagement(ctx);
      if (!gm) return;

      // Get the current goal
      const goal = await gm.getGoal(sessionID);

      if (!goal) {
        return;
      }

      // Use input which has the resolved model/agent values
      // This ensures our injected noReply message has identical model/agent
      // to the real user message, preventing mode/model switching
      await injectGoalContext(ctx, sessionID, input);
    },

    /**
     * Handle session compacted events to reinject goal context
     */
    handleSessionCompacted: async (event: { properties?: { sessionID?: string } }) => {
      const sessionID = event.properties?.sessionID;
      if (!sessionID) return;

      // Re-inject goal context on session compaction
      await injectGoalContext(ctx, sessionID);
    },
  };
}
