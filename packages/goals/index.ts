/**
 * @agent-loop/goals
 * Goal management plugin for OpenCode
 */

import type { Plugin, PluginInput, Goal, GoalManagement as IGoalManagement } from "../tools/types.js";
import { createLogger } from "../tools/logger.js";
import { updateContext, getContext } from "../tools/session-context.js";
import { getEffectiveConfig } from "../../config.js";

// Get debug level from config - use silent if debug is disabled
const config = getEffectiveConfig();
const log = createLogger("agent-loop-goals", config.debug ? "debug" : "silent");

/**
 * Goal file storage path
 */
function getGoalsPath(directory: string): string {
  return `${directory}/.goals`;
}

/**
 * Goal file path for a session
 */
function getGoalFilePath(directory: string, sessionID: string): string {
  return `${getGoalsPath(directory)}/${sessionID}/goal.json`;
}

/**
 * Read goal from file
 */
async function readGoal(filePath: string): Promise<Goal | null> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as Goal;
  } catch {
    return null;
  }
}

/**
 * Write goal to file
 */
async function writeGoal(filePath: string, goal: Goal): Promise<void> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(goal, null, 2));
  } catch (error) {
    log.error("Failed to write goal", { error, filePath });
    throw error;
  }
}

/**
 * Create goal management instance
 */
export function createGoalManagement(input: PluginInput): IGoalManagement {
  const { directory } = input;
  const pendingValidation = new Set<string>();

  async function createGoal(
    sessionID: string,
    title: string,
    done_condition: string,
    description?: string
  ): Promise<Goal> {
    const goal: Goal = {
      id: `goal-${Date.now()}`,
      sessionID,
      title,
      done_condition,
      description,
      status: "active",
      created_at: new Date().toISOString(),
    };

    const filePath = getGoalFilePath(directory, sessionID);
    await writeGoal(filePath, goal);

    log.info("Goal created", { sessionID, title });
    return goal;
  }

  async function getGoal(sessionID: string): Promise<Goal | null> {
    const filePath = getGoalFilePath(directory, sessionID);
    return readGoal(filePath);
  }

  async function completeGoal(sessionID: string): Promise<Goal | null> {
    const goal = await getGoal(sessionID);
    if (!goal || goal.status !== "active") {
      return null;
    }

    const completedGoal: Goal = {
      ...goal,
      status: "completed",
      completed_at: new Date().toISOString(),
    };

    const filePath = getGoalFilePath(directory, sessionID);
    await writeGoal(filePath, completedGoal);

    // Mark for validation
    pendingValidation.add(sessionID);
    log.info("Goal completed", { sessionID, title: goal.title });

    return completedGoal;
  }

  async function validateGoal(sessionID: string): Promise<Goal | null> {
    const goal = await getGoal(sessionID);
    if (!goal || goal.status !== "completed") {
      return null;
    }

    const validatedGoal: Goal = {
      ...goal,
      status: "validated",
      validated_at: new Date().toISOString(),
    };

    const filePath = getGoalFilePath(directory, sessionID);
    await writeGoal(filePath, validatedGoal);

    // Clear pending validation
    pendingValidation.delete(sessionID);
    log.info("Goal validated", { sessionID, title: goal.title });

    return validatedGoal;
  }

  async function checkPendingValidation(sessionID: string): Promise<boolean> {
    return pendingValidation.has(sessionID);
  }

  async function clearPendingValidation(sessionID: string): Promise<void> {
    pendingValidation.delete(sessionID);
  }

  async function cleanup(): Promise<void> {
    pendingValidation.clear();
  }

  async function handler(event: { event: unknown }): Promise<void> {
    // Handle goal-related events
    const evt = event.event as { type?: string; properties?: { info?: { sessionID?: string } } };
    
    if (evt?.type === "message.updated") {
      const info = evt.properties?.info;
      if (info?.sessionID) {
        // Update session context when messages arrive
        updateContext(info.sessionID, {
          agent: (info as { agent?: string })?.agent,
          model: (info as { model?: { providerID: string; modelID: string } })?.model,
        });
      }
    }
  }

  return {
    createGoal,
    getGoal,
    completeGoal,
    validateGoal,
    checkPendingValidation,
    clearPendingValidation,
    cleanup,
    handler,
  };
}

/**
 * Create goal tools for LLM agents
 */
export function createGoalTools(input: PluginInput) {
  let goalManagement: IGoalManagement | null = null;

  async function getGoalManagement(): Promise<IGoalManagement> {
    if (!goalManagement) {
      goalManagement = createGoalManagement(input);
    }
    return goalManagement;
  }

  async function getCurrentSessionID(): Promise<string> {
    try {
      const sessionInfo = await input.client.session.get({ path: { id: "" } });
      if ('data' in sessionInfo && sessionInfo.data && 'id' in sessionInfo.data) {
        return sessionInfo.data.id;
      }
    } catch {
      // Fallback to directory-based session ID
    }
    return `session-${input.directory.replace(/[^a-zA-Z0-9]/g, "-")}`;
  }

  return {
    goal_set: async (args: { title: string; done_condition: string; description?: string }): Promise<string> => {
      const sessionID = await getCurrentSessionID();
      const gm = await getGoalManagement();
      await gm.createGoal(sessionID, args.title, args.done_condition, args.description);

      return `✅ Goal set successfully!

**Title:** ${args.title}
**Done Condition:** ${args.done_condition}
${args.description ? `**Description:** ${args.description}` : ""}

The agent will work toward this goal. Use goal_done when the condition is met.`;
    },

    goal_status: async (): Promise<string> => {
      const sessionID = await getCurrentSessionID();
      const gm = await getGoalManagement();
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

      return `📋 Current Goal Status

**Title:** ${goal.title}
**Status:** ${statusText}
**Done Condition:** ${goal.done_condition}
${goal.description ? `**Description:** ${goal.description}` : ""}
${goal.completed_at ? `**Completed:** ${new Date(goal.completed_at).toLocaleString()}` : ""}
${goal.validated_at ? `**Validated:** ${new Date(goal.validated_at).toLocaleString()}` : ""}`;
    },

    goal_done: async (): Promise<string> => {
      const sessionID = await getCurrentSessionID();
      const gm = await getGoalManagement();
      const completedGoal = await gm.completeGoal(sessionID);

      if (!completedGoal) {
        return "⚠️ No active goal to complete. Use goal_set first.";
      }

      return `🎉 Goal completed!

**Title:** ${completedGoal.title}
**Completed At:** ${new Date(completedGoal.completed_at!).toLocaleString()}
${completedGoal.description ? `**Description:** ${completedGoal.description}` : ""}
**Done Condition:** ${completedGoal.done_condition}

The goal is now pending validation. 

**REQUIRED ACTION:** Call the goal_validate() tool to validate this goal.

Available tools: goal_validate() or goal_set()`;
    },

    goal_validate: async (): Promise<string> => {
      const sessionID = await getCurrentSessionID();
      const gm = await getGoalManagement();
      const validatedGoal = await gm.validateGoal(sessionID);

      if (!validatedGoal) {
        return "⚠️ No completed goal to validate. Use goal_done() first to mark a goal as completed, then call goal_validate().";
      }

      return `✅ GOAL VALIDATED SUCCESSFULLY!

**Title:** ${validatedGoal.title}
**Status:** ✓ Validated  
**Completed:** ${new Date(validatedGoal.completed_at!).toLocaleString()}
**Validated:** ${new Date(validatedGoal.validated_at!).toLocaleString()}
${validatedGoal.description ? `**Description:** ${validatedGoal.description}` : ""}
**Done Condition:** ${validatedGoal.done_condition}

This goal has been successfully validated and is now fully complete. 

You can now set a new goal with goal_set() or continue with other tasks.`;
    },

    goal_cancel: async (): Promise<string> => {
      const sessionID = await getCurrentSessionID();
      const gm = await getGoalManagement();
      const goal = await gm.getGoal(sessionID);

      if (!goal) {
        return "⚠️ No goal to cancel.";
      }

      // Clear pending validation if any
      await gm.clearPendingValidation(sessionID);

      return `❌ Goal cancelled

**Title:** ${goal.title}
**Status:** Cancelled

The goal has been cancelled. Set a new goal with goal_set() if needed.`;
    },
  };
}

/**
 * Goal plugin
 */
export const agentLoopGoals: Plugin = async (input: PluginInput) => {
  log.info("Initializing agent-loop-goals plugin");

  const goalManagement = createGoalManagement(input);
  const goalTools = createGoalTools(input);

  return {
    tools: [
      {
        name: "goal_set",
        description: "Set a new goal for the current session",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Goal title" },
            done_condition: { type: "string", description: "Condition that marks the goal as complete" },
            description: { type: "string", description: "Optional description" },
          },
          required: ["title", "done_condition"],
        },
        handler: async (args: unknown) => {
          return goalTools.goal_set(args as { title: string; done_condition: string; description?: string });
        },
      },
      {
        name: "goal_status",
        description: "Check the current goal status",
        parameters: { type: "object", properties: {} },
        handler: async () => {
          return goalTools.goal_status();
        },
      },
      {
        name: "goal_done",
        description: "Mark the current goal as completed",
        parameters: { type: "object", properties: {} },
        handler: async () => {
          return goalTools.goal_done();
        },
      },
      {
        name: "goal_validate",
        description: "VALIDATE the completed goal - Required step after goal_done(). Use this to confirm the done condition is satisfied and mark the goal as fully complete.",
        parameters: { type: "object", properties: {} },
        handler: async () => {
          return goalTools.goal_validate();
        },
      },
      {
        name: "goal_cancel",
        description: "Cancel the current goal",
        parameters: { type: "object", properties: {} },
        handler: async () => {
          return goalTools.goal_cancel();
        },
      },
    ],
    event: async ({ event }) => {
      await goalManagement.handler({ event });
    },
  };
};

export default agentLoopGoals;
