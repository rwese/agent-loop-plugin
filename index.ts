/**
 * Agent Loop Plugin - Main Entry Point
 *
 * Composes goal management and task continuation plugins into a unified experience.
 * This is the main plugin that users should load.
 */

import type { Plugin, PluginInput } from "./packages/tools/types.js";
import { createLogger } from "./packages/tools/logger.js";
import { getEffectiveConfig } from "./config.js";

// Import plugin composers (exported for users)
import { createGoalManagement, createGoalTools } from "./packages/goals/index.js";
import { createTaskContinuation } from "./packages/continuation/index.js";

// Re-export session context utilities for plugin authors
export { initSessionContext, sessionContext } from "./src/session-context.js";

/**
 * Main agent-loop plugin
 * Combines goal management and task continuation
 */
export const agentLoopPlugin: Plugin = async (input: PluginInput) => {
  // Load configuration to determine debug level
  const config = getEffectiveConfig();
  
  // Create logger - use debug level if enabled, otherwise silent
  const log = createLogger("agent-loop-plugin", config.debug ? "debug" : "silent");
  
  log.info("Initializing agent-loop plugin", {
    logFilePath: config.logFilePath ?? "default",
    countdownSeconds: config.countdownSeconds,
  });

  // Create shared goal management (used by both plugins)
  const goalManagement = createGoalManagement(input);

  // Create task continuation with goal awareness
  const taskContinuation = createTaskContinuation(input, {}, goalManagement);

  // Create goal tools for LLM agents
  const goalTools = createGoalTools(input);

  return {
    // Compose tools from both plugins
    tools: [
      // Goal management tools
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
        description: "Validate a completed goal",
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
      // Delegate to both plugins
      await goalManagement.handler({ event });
      await taskContinuation.handler({ event });
    },
  };
};

// Export creation functions
export { createGoalManagement } from "./packages/goals/index.js";
export { createTaskContinuation } from "./packages/continuation/index.js";

export default agentLoopPlugin;
