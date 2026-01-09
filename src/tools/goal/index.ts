/**
 * Goal Tools for OpenCode Agents
 *
 * Exposes goal management functionality to LLM agents,
 * allowing them to set and manage goals during conversations.
 */

import type { PluginInput } from "@opencode-ai/plugin";
import { goal_set } from "./goal_set.js";
import { goal_status } from "./goal_status.js";
import { goal_done } from "./goal_done.js";
import { goal_cancel } from "./goal_cancel.js";

/**
 * Create goal tool handlers bound to a plugin context
 */
export function createGoalTools(_ctx: PluginInput) {
  return {
    /**
     * goal_set - Set a new goal for the current session
     */
    goal_set,
    
    /**
     * goal_status - Check the current goal status
     */
    goal_status,
    
    /**
     * goal_done - Mark the current goal as completed
     */
    goal_done,
    
    /**
     * goal_cancel - Cancel the current goal
     */
    goal_cancel,
  };
}