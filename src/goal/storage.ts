/**
 * File Operations for Goal Storage
 *
 * Handles reading and writing goal data to the file system.
 */

import type { Goal } from "../types.js";
import { GOALS_BASE_PATH, GOAL_FILENAME } from "../types.js";

/**
 * Expand tilde path to home directory
 */
function expandHomeDir(path: string): string {
  if (path.startsWith("~")) {
    return path.replace("~", process.env.HOME ?? process.env.USERPROFILE ?? "~");
  }
  return path;
}

/**
 * Get the goal file path for a session
 */
export function getGoalFilePath(sessionID: string, basePath: string = GOALS_BASE_PATH): string {
  const expandedBase = expandHomeDir(basePath);
  return `${expandedBase}/${sessionID}/${GOAL_FILENAME}`;
}

/**
 * Read a goal from file storage
 */
export async function readGoal(sessionID: string, basePath: string = GOALS_BASE_PATH): Promise<Goal | null> {
  try {
    const goalPath = getGoalFilePath(sessionID, basePath);
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(goalPath, "utf-8");

    // Handle empty or undefined content
    if (!content || content.trim() === "") {
      return null;
    }

    const goal = JSON.parse(content) as Goal;

    // Validate basic structure
    if (!goal.title || !goal.done_condition || !goal.created_at) {
      return null;
    }

    // Validate status
    if (!["active", "completed"].includes(goal.status)) {
      return null;
    }

    return goal;
  } catch (error) {
    // Handle specific error types
    if (error instanceof Error) {
      // File doesn't exist - no goal set
      if ("code" in error && error.code === "ENOENT") {
        return null;
      }

      // JSON parsing error - corrupted file, treat as no goal
      if (error instanceof SyntaxError) {
        console.error(`Error reading goal for session ${sessionID}: Invalid JSON format`);
        return null;
      }
    }

    // Log other errors but return null
    console.error(`Error reading goal for session ${sessionID}:`, error);
    return null;
  }
}

/**
 * Write a goal to file storage
 */
export async function writeGoal(
  sessionID: string,
  goal: Goal,
  basePath: string = GOALS_BASE_PATH
): Promise<void> {
  try {
    const goalPath = getGoalFilePath(sessionID, basePath);
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    // Ensure directory exists
    const dirPath = path.dirname(goalPath);
    await fs.mkdir(dirPath, { recursive: true });

    // Write goal file
    await fs.writeFile(goalPath, JSON.stringify(goal, null, 2), "utf-8");
  } catch (error) {
    console.error(`Error writing goal for session ${sessionID}:`, error);
    throw error;
  }
}

/**
 * Delete a goal file
 */
export async function deleteGoal(sessionID: string, basePath: string = GOALS_BASE_PATH): Promise<boolean> {
  try {
    const goalPath = getGoalFilePath(sessionID, basePath);
    const fs = await import("node:fs/promises");
    await fs.unlink(goalPath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false; // File didn't exist
    }
    console.error(`Error deleting goal for session ${sessionID}:`, error);
    return false;
  }
}