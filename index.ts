/**
 * Agent Loop Plugin - Main Entry Point
 *
 * Composes task continuation plugin into a unified experience.
 * This is the main plugin that users should load.
 */

import type { Plugin, PluginInput } from "./packages/tools/types.js";
import { createLogger } from "./packages/tools/logger.js";
import { getEffectiveConfig } from "./config.js";

// Import plugin composers (exported for users)
import { createTaskContinuation } from "./packages/continuation/index.js";

// Re-export session context utilities for plugin authors
export { initSessionContext, sessionContext } from "./src/session-context.js";

/**
 * Main agent-loop plugin
 * Provides task continuation capabilities
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

  // Create task continuation
  const taskContinuation = createTaskContinuation(input, {});

  return {
    // Compose tools from task continuation plugin
    tools: [],
    event: async ({ event }) => {
      // Delegate to task continuation plugin
      await taskContinuation.handler({ event });
    },
  };
};

// Export creation functions
export { createTaskContinuation } from "./packages/continuation/index.js";

export default agentLoopPlugin;