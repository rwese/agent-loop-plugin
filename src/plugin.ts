/**
 * Agent Loop Plugin - Main Entry Point
 *
 * Plugin infrastructure for task continuation and goal management.
 * Automatically continues sessions when incomplete tasks remain.
 */

import type { Plugin } from "@opencode-ai/plugin";
import type { PluginContext, PluginResult } from "./types.js";
import { createLogger, initLogger } from "./logger.js";
import { createTaskContinuation } from "./goal/continuation.js";
import { createGoalManagement } from "./goal/management.js";
import { createGoalTools } from "./tools/goal/index.js";

const log = createLogger("plugin");

/**
 * Agent Loop Plugin
 *
 * Provides task continuation and goal management capabilities for OpenCode agents.
 * Automatically continues sessions when incomplete tasks remain.
 *
 * @param ctx - PluginContext containing session client and configuration
 * @returns PluginResult with tools and event handlers
 */
export const agentLoopPlugin: Plugin = async (
  ctx: PluginContext
): Promise<PluginResult> => {
  initLogger(ctx.client);

  log.info("Initializing agent loop plugin");

  // Create goal management instance
  const goalManagement = createGoalManagement(ctx, {});

  // Create task continuation with goal awareness
  const taskContinuation = createTaskContinuation(ctx, {
    goalManagement,
  });

  // Create goal tools for agents
  const goalTools = createGoalTools(ctx);

  log.info("Agent loop plugin initialized successfully");

  return {
    tool: {
      goal_set: goalTools.goal_set,
      goal_status: goalTools.goal_status,
      goal_done: goalTools.goal_done,
      goal_cancel: goalTools.goal_cancel,
    },
    event: async ({ event }) => {
      if (!event) {
        return;
      }

      // Handle session deletion cleanup
      if (event.type === "session.deleted") {
        const sessionId = (event as { properties?: { info?: { id?: string } } })?.properties?.info?.id;
        if (sessionId) {
          log.info("Cleaning up for deleted session", { sessionId });
          await goalManagement.cleanup();
          await taskContinuation.cleanup();
        }
      }

      // Handle session events for both goal management and task continuation
      await goalManagement.handler({ event });
      await taskContinuation.handler({ event });
    },
  };
};

export default agentLoopPlugin;