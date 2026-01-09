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
import { createGoalContextInjection, injectValidationPrompt } from "./goal-context-injection.js";

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

  // Create goal context injection handler
  const goalContext = createGoalContextInjection(ctx);

  log.info("Agent loop plugin initialized successfully");

  return {
    tool: {
      goal_set: goalTools.goal_set,
      goal_status: goalTools.goal_status,
      goal_done: goalTools.goal_done,
      goal_cancel: goalTools.goal_cancel,
      goal_validate: goalTools.goal_validate,
    },
    "chat.message": async (input: {
      sessionID: string;
      agent?: string;
      model?: { providerID: string; modelID: string };
      messageID?: string;
      variant?: string;
    }) => {
      // Handle goal context injection for chat messages
      await goalContext.handleChatMessage({
        sessionID: input.sessionID,
        model: input.model,
        agent: input.agent,
      });

      // Check if this session has a goal pending validation
      const hasPendingValidation = await goalManagement.checkPendingValidation(input.sessionID);
      
      if (hasPendingValidation) {
        // Inject validation prompt
        await injectValidationPrompt(ctx, input.sessionID);
        // Clear the pending validation flag
        await goalManagement.clearPendingValidation(input.sessionID);
      }

      // Log client structure for debugging
      try {
        const client = ctx.client;
        log.debug("Chat message client structure", {
          hasClient: !!client,
          clientKeys: client ? Object.keys(client) : [],
          hasSession: !!client?.session,
          sessionKeys: client?.session ? Object.keys(client.session) : [],
          hasSessionPrompt: !!client?.session?.prompt,
        });
      } catch (error) {
        log.warn("Failed to log client structure", { error });
      }
    },
    event: async ({ event }) => {
      if (!event) {
        return;
      }

      // Handle session compaction for goal context re-injection
      if (event.type === "session.compacted") {
        await goalContext.handleSessionCompacted(event as { properties?: { sessionID?: string } });
      }

      // Handle goal_done command to inject validation prompt
      const eventData = event as { type: string; properties?: { info?: { command?: string; sessionID?: string } } };
      if (eventData.type === "command" && eventData.properties?.info?.command === "goal_done" && eventData.properties.info.sessionID) {
        // Inject validation prompt after goal is marked as completed
        await injectValidationPrompt(ctx, eventData.properties.info.sessionID);
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