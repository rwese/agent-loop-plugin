/**
 * Custom Goal Tools for OpenCode Agents
 *
 * These tools expose the agent-loop-plugin goal management functionality to LLM agents,
 * allowing them to set and manage goals during conversations.
 *
 * Tools are automatically available to all agents when this plugin is loaded.
 */

import type { PluginInput } from "@opencode-ai/plugin";

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Create goal tool handlers bound to a plugin context
 */
export function createGoalTools(ctx: PluginInput) {
  // Lazy-loaded to avoid circular dependencies
  let goalManagement: ReturnType<typeof import("./index.js").createGoalManagement> | null = null

  async function getGoalManagement() {
    if (!goalManagement) {
      const mod = await import("./index.js")
      goalManagement = mod.createGoalManagement(ctx, {})
    }
    return goalManagement
  }

  async function getCurrentSessionID(): Promise<string> {
    // Try to get session ID from context
    try {
      const sessionInfo = await ctx.client.session.get({ path: { id: "" } })
      // Handle both success and error cases
      if ('data' in sessionInfo && sessionInfo.data && 'id' in sessionInfo.data) {
        return sessionInfo.data.id
      }
      throw new Error('Invalid session response')
    } catch {
      // Fallback: generate a consistent ID based on directory
      return `session-${ctx.directory.replace(/[^a-zA-Z0-9]/g, "-")}`
    }
  }

  return {
    /**
     * goal_set - Set a new goal for the current session
     *
     * Usage: Call this tool when the user wants to establish a clear objective.
     * The goal will guide agent behavior until completed.
     */
    goal_set: async (args: {
      title: string
      done_condition: string
      description?: string
    }): Promise<string> => {
      const sessionID = await getCurrentSessionID()
      const gm = await getGoalManagement()

      await gm.createGoal(sessionID, args.title, args.done_condition, args.description)

      return `✅ Goal set successfully!

**Title:** ${args.title}
**Done Condition:** ${args.done_condition}
${args.description ? `**Description:** ${args.description}` : ""}

The agent will work toward this goal. Use goal_done when the condition is met.`
    },

    /**
     * goal_status - Check the current goal status
     *
     * Usage: Call this tool to understand what goal (if any) is active
     * and what progress has been made.
     */
    goal_status: async (): Promise<string> => {
      const sessionID = await getCurrentSessionID()
      const gm = await getGoalManagement()

      const goal = await gm.getGoal(sessionID)

      if (!goal) {
        return "📋 No active goal for this session."
      }

      const statusText = goal.status === "active" ? "🟡 In Progress" : "✅ Completed"
      const completedText = goal.completed_at
        ? `\n**Completed:** ${new Date(goal.completed_at).toLocaleString()}`
        : ""

      return `🎯 **Current Goal:** ${goal.title}
${goal.description ? `**Description:** ${goal.description}` : ""}
**Status:** ${statusText}
**Done Condition:** ${goal.done_condition}
**Created:** ${new Date(goal.created_at).toLocaleString()}${completedText}`
    },

    /**
     * goal_done - Mark the current goal as completed
     *
     * Usage: Call this tool when you've satisfied the goal's done condition.
     * Only works if there is an active (non-completed) goal.
     */
    goal_done: async (): Promise<string> => {
      const sessionID = await getCurrentSessionID()
      const gm = await getGoalManagement()

      const completedGoal = await gm.completeGoal(sessionID)

      if (!completedGoal) {
        return "⚠️ No active goal to complete. Use goal_set first."
      }

      return `🎉 Goal completed!

**Title:** ${completedGoal.title}
**Completed At:** ${new Date(completedGoal.completed_at!).toLocaleString()}

The goal has been marked as complete.`
    },

    /**
     * goal_cancel - Cancel the current goal
     *
     * Usage: Call this tool to abandon the current goal without completing it.
     */
    goal_cancel: async (args: { reason?: string }): Promise<string> => {
      const sessionID = await getCurrentSessionID()
      const gm = await getGoalManagement()

      const goal = await gm.getGoal(sessionID)

      if (!goal) {
        return "⚠️ No active goal to cancel."
      }

      const wasActive = goal.status === "active"

      // For now, we complete it (could add a cancelled status in future)
      await gm.completeGoal(sessionID)

      const reasonText = args.reason ? `\n**Reason:** ${args.reason}` : ""
      const statusText = wasActive
        ? "The goal was active and has been removed."
        : "The goal was already completed."

      return `🚫 Goal cancelled.

**Title:** ${goal.title}${reasonText}
${statusText}`
    },
  }
}

// ============================================================================
// Tool Definitions for OpenCode Plugin Registration
// ============================================================================

/**
 * Create tool definitions using OpenCode plugin system format
 */
export function createToolDefinitions(ctx: PluginInput): Record<string, object> {
  const tools = createGoalTools(ctx)

  return {
    goal_set: {
      description: "Set a new goal for the current session. Establishes clear objectives that guide agent behavior.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The goal title - what you want to accomplish" },
          done_condition: { type: "string", description: "How to know when the goal is complete - specific criteria" },
          description: { type: "string", description: "Optional detailed description of the goal" },
        },
        required: ["title", "done_condition"],
      },
      async execute(args: unknown, _context: unknown) {
        return tools.goal_set(args as { title: string; done_condition: string; description?: string })
      },
    },

    goal_status: {
      description: "Check the current goal status and details.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      async execute(_args: unknown, _context: unknown) {
        return tools.goal_status()
      },
    },

    goal_done: {
      description: "Mark the current goal as completed. Use when you've satisfied the goal's done condition.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
      async execute(_args: unknown, _context: unknown) {
        return tools.goal_done()
      },
    },

    goal_cancel: {
      description: "Cancel the current goal without completing it.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Optional reason for cancelling the goal" },
        },
        required: [],
      },
      async execute(args: unknown, _context: unknown) {
        return tools.goal_cancel(args as { reason?: string })
      },
    },
  }
}

// ============================================================================
// Export tools for OpenCode plugin system
// ============================================================================

/**
 * Register goal tools with the OpenCode agent system
 * Returns both the tool implementations and their definitions
 */
export async function registerGoalTools(ctx: PluginInput) {
  const tools = createGoalTools(ctx)
  const toolDefinitions = createToolDefinitions(ctx)

  return {
    tools,
    toolDefinitions,
  } as { tools: ReturnType<typeof createGoalTools>; toolDefinitions: Record<string, object> }
}
