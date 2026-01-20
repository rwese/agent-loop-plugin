/**
 * Agent Loop Plugin - Main Entry Point
 *
 * Plugin infrastructure for task continuation.
 * Automatically continues sessions when incomplete tasks remain.
 */

import type { Plugin } from "@opencode-ai/plugin";
import type { PluginContext, PluginResult } from "./types.js";
import { createTaskContinuation } from "../packages/continuation/index.js";
import { initSessionContext } from "./session-context.js";

/**
 * Agent Loop Plugin
 *
 * Provides task continuation capabilities for OpenCode agents.
 * Automatically continues sessions when incomplete tasks remain.
 *
 * @param ctx - PluginContext containing session client and configuration
 * @returns PluginResult with tools and event handlers
 */
export const agentLoopPlugin: Plugin = async (
  ctx: PluginContext
): Promise<PluginResult> => {
  initSessionContext(ctx);

  // Create task continuation
  const taskContinuation = createTaskContinuation(ctx, {});

  return {
    tool: {},
    "chat.message": async () => {
      // Handle chat messages for task continuation
    },
    event: async ({ event }) => {
      if (!event) {
        return;
      }

      // Handle session deletion cleanup
      if (event.type === "session.deleted") {
        const sessionId = (event as { properties?: { info?: { id?: string } } })?.properties?.info?.id;
        if (sessionId) {
          await taskContinuation.cleanup();
        }
      }

      // Handle session events for task continuation
      await taskContinuation.handler({ event });
    },
  };
};

export default agentLoopPlugin;