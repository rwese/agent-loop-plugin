/**
 * Goal Management Implementation
 *
 * Core logic for managing agent goals during sessions.
 */

import type { PluginContext, Goal, GoalManagement, GoalManagementOptions, LoopEvent } from "../types.js";
import { readGoal, writeGoal } from "./storage.js";
import { createLogger } from "../logger.js";

const log = createLogger("goal-management");

/**
 * Create a new goal management instance
 */
export function createGoalManagement(
  ctx: PluginContext,
  options: GoalManagementOptions = {}
): GoalManagement {
  const { goalsBasePath } = options;

  async function readGoalForSession(sessionID: string): Promise<Goal | null> {
    return readGoal(sessionID, goalsBasePath);
  }

  async function writeGoalForSession(sessionID: string, goal: Goal): Promise<void> {
    return writeGoal(sessionID, goal, goalsBasePath);
  }

  async function createNewGoal(
    sessionID: string,
    title: string,
    doneCondition: string,
    description?: string
  ): Promise<Goal> {
    const goal: Goal = {
      title,
      description,
      done_condition: doneCondition,
      status: "active",
      created_at: new Date().toISOString(),
      completed_at: null,
    };

    await writeGoalForSession(sessionID, goal);
    return goal;
  }

  async function markGoalComplete(sessionID: string): Promise<Goal | null> {
    const goal = await readGoalForSession(sessionID);

    if (!goal) {
      return null;
    }

    const completedGoal: Goal = {
      ...goal,
      status: "completed",
      completed_at: new Date().toISOString(),
    };

    await writeGoalForSession(sessionID, completedGoal);
    return completedGoal;
  }

  async function checkActiveGoal(sessionID: string): Promise<boolean> {
    const goal = await readGoalForSession(sessionID);
    return goal !== null && goal.status === "active";
  }

  /**
   * Handle goal-related events from OpenCode
   */
  async function handleGoalEvent(sessionID: string, event?: LoopEvent): Promise<void> {
    const info = event?.properties?.info;

    // Handle goal.set command
    if (event?.type === "command" && info) {
      const commandInfo = info as { command?: string; args?: Record<string, unknown> };

      if (commandInfo.command === "goal_set") {
        const args = commandInfo.args ?? {};
        const title = args.title as string;
        const doneCondition = args.done_condition as string;
        const description = args.description as string | undefined;

        if (!title || !doneCondition) {
          log.error("goal_set command requires title and done_condition");
          return;
        }

        await createNewGoal(sessionID, title, doneCondition, description);
        log.info(`Goal created for session ${sessionID}: ${title}`);
      }

      // Handle goal.done command
      if (commandInfo.command === "goal_done") {
        const completedGoal = await markGoalComplete(sessionID);
        if (completedGoal) {
          log.info(`Goal completed for session ${sessionID}: ${completedGoal.title}`);
        }
      }
    }
  }

  const handler = async ({ event }: { event: LoopEvent }): Promise<void> => {
    const props = event.properties;
    const sessionID = props?.sessionID as string | undefined;

    if (!sessionID) {
      // Try to extract from info
      const info = props?.info as { sessionID?: string } | undefined;
      if (info?.sessionID) {
        await handleGoalEvent(info.sessionID, event);
      }
      return;
    }

    await handleGoalEvent(sessionID, event);
  };

  const cleanup = async (): Promise<void> => {
    // Cleanup is handled by file system for goal files
    // No persistent file handles or in-memory state to clean
    // All resources are transient and managed by the file system
    log.debug("Goal management cleanup completed");
  };

  return {
    readGoal: readGoalForSession,
    writeGoal: writeGoalForSession,
    createGoal: createNewGoal,
    completeGoal: markGoalComplete,
    getGoal: readGoalForSession,
    hasActiveGoal: checkActiveGoal,
    handler,
    cleanup,
  };
}