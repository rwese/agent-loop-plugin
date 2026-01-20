/**
 * @agent-loop/continuation
 * Task continuation plugin for OpenCode
 * Automatically continues sessions when incomplete tasks remain
 */

import type { Plugin, PluginInput, GoalManagement } from "../tools/types.js";
import { createLogger } from "../tools/logger.js";
import { getContext } from "../tools/session-context.js";
import { getEffectiveConfig } from "../../config.js";

// Get debug level from config - use silent if debug is disabled
const config = getEffectiveConfig();
const log = createLogger("agent-loop-continuation", config.debug ? "debug" : "silent");

/**
 * Task continuation options
 */
export interface TaskContinuationOptions {
  countdownSeconds?: number;
  errorCooldownMs?: number;
  toastDurationMs?: number;
}

/**
 * Continuation state
 */
interface ContinuationState {
  pendingCountdowns: Map<string, NodeJS.Timeout>;
  errorCooldowns: Map<string, number>;
  recoveringSessions: Set<string>;
}

/**
 * Create task continuation instance
 */
export function createTaskContinuation(
  input: PluginInput,
  options: TaskContinuationOptions = {},
  goalManagement?: GoalManagement
) {
  const { client } = input;
  const {
    countdownSeconds = 2,
    errorCooldownMs = 3000,
    toastDurationMs = 900,
  } = options;

  const state: ContinuationState = {
    pendingCountdowns: new Map(),
    errorCooldowns: new Map(),
    recoveringSessions: new Set(),
  };

  /**
   * Fetch todos for a session
   */
  async function fetchTodos(sessionID: string) {
    try {
      const response = await client.session.todo({
        path: { id: sessionID },
      });
      // Handle both array response and object with data property
      return Array.isArray(response) ? response : (response?.data || []);
    } catch {
      return [];
    }
  }

  /**
   * Get incomplete todo count
   */
  function getIncompleteCount(todos: Array<{ status?: string }>): number {
    return todos.filter((t) => t.status !== "completed" && t.status !== "cancelled").length;
  }

  /**
   * Get agent/model for a session
   */
  async function getAgentModel(sessionID: string) {
    const context = getContext(sessionID);
    return {
      agent: context.agent,
      model: context.model,
    };
  }

  /**
   * Build continuation prompt from todos
   */
  function buildContinuationPrompt(todos: Array<{ id: string; content: string; status: string }>): string {
    const incomplete = todos.filter((t) => t.status !== "completed" && t.status !== "cancelled");

    if (incomplete.length === 0) {
      return "";
    }

    const prompt = `[SYSTEM - TASK CONTINUATION]

INCOMPLETE TASKS (${incomplete.length}):
${incomplete.map((t, i) => `${i + 1}. ${t.content}`).join("\n")}

INSTRUCTIONS:
1. Review the incomplete tasks above
2. Continue working on them systematically
3. Use todo_write to update task status when complete
4. Ask for clarification if any task is unclear`

    return prompt;
  }

  /**
   * Inject continuation into session
   */
  async function injectContinuation(sessionID: string): Promise<void> {
    // Check error cooldown
    const lastError = state.errorCooldowns.get(sessionID) ?? 0;
    if (Date.now() - lastError < errorCooldownMs) {
      log.debug("Session in error cooldown, skipping continuation", { sessionID });
      return;
    }

    const todos = await fetchTodos(sessionID);
    const incompleteCount = getIncompleteCount(todos);

    // Check for pending validation
    let hasPendingValidation = false;
    if (goalManagement) {
      hasPendingValidation = await goalManagement.checkPendingValidation(sessionID);
    }

    // Skip if no work to do and no validation pending
    if (incompleteCount === 0 && !hasPendingValidation) {
      log.debug("No incomplete tasks or pending validation, skipping continuation", { sessionID });
      return;
    }

    // Get agent/model
    const agentModel = await getAgentModel(sessionID);

    // Build prompt
    let prompt = "";
    if (incompleteCount > 0) {
      prompt = buildContinuationPrompt(todos);
    }

    // Add validation prompt if pending
    if (hasPendingValidation && goalManagement) {
      const goal = await goalManagement.getGoal(sessionID);
      if (goal) {
        if (prompt.length > 0) {
          prompt += "\n\n";
        }
        prompt += `## Goal Validation Required

The goal "${goal.title}" has been marked as completed.

**Please review and verify the done condition:**

**Done Condition:** ${goal.done_condition}
${goal.description ? `**Description:** ${goal.description}` : ""}

**Your task:**
Call goal_validate() to validate this goal.

If not yet complete, you can set a new goal with goal_set().`;

        // Clear pending validation
        await goalManagement.clearPendingValidation(sessionID);
      }
    }

    // Inject prompt
    try {
      await client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: agentModel.agent,
          model: agentModel.model,
          parts: [{ type: "text", text: prompt }],
        },
      });

      log.info("Continuation injected", {
        sessionID,
        incompleteCount,
        hasPendingValidation,
      });
    } catch (error) {
      log.error("Failed to inject continuation", { sessionID, error });
      state.errorCooldowns.set(sessionID, Date.now());
    }
  }

  /**
   * Schedule continuation for a session
   */
  async function scheduleContinuation(sessionID: string): Promise<void> {
    // Clear existing countdown
    const existingTimeout = state.pendingCountdowns.get(sessionID);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Schedule new countdown
    const timeout = setTimeout(async () => {
      state.pendingCountdowns.delete(sessionID);
      try {
        await injectContinuation(sessionID);
      } catch (error) {
        log.error("Continuation error", { sessionID, error });
      }
    }, countdownSeconds * 1000);

    state.pendingCountdowns.set(sessionID, timeout);
    log.debug("Continuation scheduled", { sessionID, countdownSeconds });

    // Show toast
    try {
      await client.tui.showToast({
        body: {
          title: "Auto-Continuing",
          message: `Continuing in ${countdownSeconds} seconds...`,
          variant: "info",
          duration: toastDurationMs,
        },
      });
    } catch {
      // Ignore toast errors
    }
  }

  /**
   * Handle session becoming idle
   */
  async function handleSessionIdle(sessionID: string): Promise<void> {
    // Check if session is recovering
    if (state.recoveringSessions.has(sessionID)) {
      return;
    }

    // Check error cooldown
    const lastError = state.errorCooldowns.get(sessionID) ?? 0;
    if (Date.now() - lastError < errorCooldownMs) {
      return;
    }

    const todos = await fetchTodos(sessionID);
    const incompleteCount = getIncompleteCount(todos);

    log.debug("Session idle", { sessionID, incompleteCount });

    // Check for active goals
    let hasActiveGoal = false;
    if (goalManagement) {
      const goal = await goalManagement.getGoal(sessionID);
      hasActiveGoal = goal !== null && goal.status === "active";
    }

    // Check for pending validation
    let hasPendingValidation = false;
    if (goalManagement) {
      hasPendingValidation = await goalManagement.checkPendingValidation(sessionID);
    }

    // Continue if there are incomplete todos OR active goals OR pending validation
    if (incompleteCount === 0 && !hasActiveGoal && !hasPendingValidation) {
      return;
    }

    await scheduleContinuation(sessionID);
  }

  /**
   * Handle session error
   */
  async function handleSessionError(sessionID: string): Promise<void> {
    // Clear any pending countdown
    const existingTimeout = state.pendingCountdowns.get(sessionID);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      state.pendingCountdowns.delete(sessionID);
    }

    // Set error cooldown
    state.errorCooldowns.set(sessionID, Date.now());
  }

  /**
   * Handle user message - cancel countdown for new genuine messages
   */
  async function handleUserMessage(
    sessionID: string,
    messageID: string,
    hasSummary: boolean
  ): Promise<void> {
    // Only cancel if this is a genuine new user message (has summary)
    // and not just a message update
    if (!hasSummary) {
      return;
    }

    const existingTimeout = state.pendingCountdowns.get(sessionID);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      state.pendingCountdowns.delete(sessionID);
      log.debug("Countdown cancelled for new user message", { sessionID, messageID });
    }
  }

  /**
   * Main event handler
   */
  async function handler(event: { event: unknown }): Promise<void> {
    const evt = event.event as { type?: string; properties?: { sessionID?: string; info?: { sessionID?: string; id?: string } } };

    if (!evt?.type) {
      return;
    }

    // Extract sessionID from either direct property or info object
    const sessionID = evt.properties?.sessionID || evt.properties?.info?.sessionID;
    const messageID = evt.properties?.info?.id;

    if (!sessionID) {
      return;
    }

    switch (evt.type) {
      case "session.idle":
        await handleSessionIdle(sessionID);
        break;

      case "session.error":
        await handleSessionError(sessionID);
        break;

      case "session.recovering":
        state.recoveringSessions.add(sessionID);
        break;

      case "session.recovered":
        state.recoveringSessions.delete(sessionID);
        break;

      case "message.updated": {
        const info = evt.properties?.info;
        const hasSummary = !!(info as { summary?: unknown } | undefined)?.summary;
        await handleUserMessage(sessionID, messageID || "", hasSummary);
        break;
      }
    }
  }

  /**
   * Cleanup resources
   */
  async function cleanup(): Promise<void> {
    // Clear all countdowns
    for (const timeout of state.pendingCountdowns.values()) {
      clearTimeout(timeout);
    }
    state.pendingCountdowns.clear();
    state.errorCooldowns.clear();
    state.recoveringSessions.clear();
  }

  return {
    handler,
    cleanup,
    scheduleContinuation,
    markRecovering: (sessionID: string) => {
      state.recoveringSessions.add(sessionID);
    },
    markRecoveryComplete: (sessionID: string) => {
      state.recoveringSessions.delete(sessionID);
    },
    cancel: (sessionID: string) => {
      const existingTimeout = state.pendingCountdowns.get(sessionID);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        state.pendingCountdowns.delete(sessionID);
      }
      state.errorCooldowns.delete(sessionID);
      state.recoveringSessions.delete(sessionID);
    },
  };
}

/**
 * Continuation plugin
 */
export const agentLoopContinuation: Plugin = async (input: PluginInput) => {
  log.info("Initializing agent-loop-continuation plugin");

  const continuation = createTaskContinuation(input);

  return {
    event: async ({ event }) => {
      await continuation.handler({ event });
    },
  };
};

export default agentLoopContinuation;
