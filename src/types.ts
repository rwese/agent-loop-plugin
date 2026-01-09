/**
 * Plugin Types
 *
 * Type definitions following the OpenCode plugin pattern.
 * Imports types from @opencode-ai/plugin for consistency.
 */

import type { Plugin } from "@opencode-ai/plugin";

/**
 * Plugin context type from OpenCode plugin system
 */
export type PluginContext = Parameters<Plugin>[0];

/**
 * Plugin result type from OpenCode plugin system
 */
export type PluginResult = Awaited<ReturnType<Plugin>>;

/**
 * Model specification following OpenCode SDK format
 */
export interface ModelSpec {
  /** Provider ID (e.g., "anthropic", "openai") */
  providerID: string;
  /** Model ID (e.g., "claude-3-5-sonnet-20241022") */
  modelID: string;
}

/**
 * Message part for prompting
 */
export interface PromptPart {
  type: string;
  text: string;
  ignored?: boolean;
}

/**
 * Session information from OpenCode SDK
 */
export interface SessionInfo {
  id: string;
  agent?: string;
  model?: string | ModelSpec;
  title?: string;
  status?: {
    type: "idle" | "busy";
  };
}

/**
 * Message information from OpenCode SDK
 */
export interface MessageInfo {
  id: string;
  sessionID: string;
  agent?: string;
  model?: string | ModelSpec;
  role: "user" | "assistant";
  time?: {
    created: number;
    completed?: number;
  };
  finish?: string;
}

/**
 * Represents a single todo/task item
 */
export interface Todo {
  /** Unique todo identifier */
  id: string;
  /** Description of the task */
  content: string;
  /** Current status of the task */
  status: "pending" | "in_progress" | "completed" | "cancelled";
  /** Priority level of the task */
  priority: string;
}

/**
 * Represents an event from the OpenCode plugin system
 */
export interface LoopEvent {
  /** Type of event (e.g., "session.idle", "session.error") */
  type: string;
  /** Event properties containing session and event-specific data */
  properties?: {
    /** Session ID this event relates to */
    sessionID?: string;
    /** Path to the transcript file (when available) */
    transcriptPath?: string;
    /** Error object (for error events) */
    error?: unknown;
    /** Message info (for message events) */
    info?: {
      id?: string;
      sessionID?: string;
      role?: string;
      agent?: string;
      model?: string | ModelSpec;
    };
    /** Additional event properties */
    [key: string]: unknown;
  };
}

/**
 * Log level for controlling output verbosity
 */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

/**
 * Logger interface for consistent logging across the codebase
 */
export interface Logger {
  /** Log a debug message */
  debug(message: string, data?: Record<string, unknown>): void;
  /** Log an info message */
  info(message: string, data?: Record<string, unknown>): void;
  /** Log a warning message */
  warn(message: string, data?: Record<string, unknown>): void;
  /** Log an error message */
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Configuration options for task continuation plugin
 */
export interface TaskContinuationOptions {
  /** Seconds to wait before auto-continuation (default: 2) */
  countdownSeconds?: number;
  /** Cooldown period in ms after errors (default: 3000) */
  errorCooldownMs?: number;
  /** Toast notification duration in ms (default: 900) */
  toastDurationMs?: number;
  /** Agent name for continuation prompts */
  agent?: string;
  /** Model name for continuation prompts */
  model?: string;
  /** Path to log file for debugging */
  logFilePath?: string;
  /** Goal management instance for goal-aware continuation */
  goalManagement?: GoalManagement;
}

/**
 * Public interface returned by createTaskContinuation
 */
export interface TaskContinuation {
  /** Event handler for session events */
  handler: (input: { event: LoopEvent }) => Promise<void>;
  /** Mark a session as recovering (pauses auto-continuation) */
  markRecovering: (sessionID: string) => void;
  /** Mark recovery as complete (resumes auto-continuation) */
  markRecoveryComplete: (sessionID: string) => void;
  /** Cancel any pending continuation for a session and clear related state */
  cancel: (sessionID: string) => void;
  /** Cleanup session state */
  cleanup: () => Promise<void>;
}

// ============================================================================
// Goal Management Types
// ============================================================================

/**
 * Represents a goal for the agent loop session.
 * Only one goal exists per session - new goal_set overwrites existing.
 */
export interface Goal {
  /** Title of the goal */
  title: string;
  /** Optional detailed description of the goal */
  description?: string;
  /** String description of what constitutes goal completion */
  done_condition: string;
  /** Current status of the goal */
  status: "active" | "completed" | "validated";
  /** ISO timestamp when the goal was created */
  created_at: string;
  /** ISO timestamp when the goal was completed, null if not completed */
  completed_at: string | null;
  /** ISO timestamp when the goal was validated, null if not validated */
  validated_at: string | null;
}

/**
 * Path to the goals storage directory
 */
export const GOALS_BASE_PATH = "~/.local/share/opencode/plugin/agent-loop";

/**
 * Filename for the goal JSON file
 */
export const GOAL_FILENAME = "goal.json";

/**
 * Configuration options for goal management plugin
 */
export interface GoalManagementOptions {
  /** Custom base path for goal storage (defaults to standard OpenCode path) */
  goalsBasePath?: string;
}

/**
 * Public interface returned by createGoalManagement
 */
export interface GoalManagement {
  /** Read the current goal for a session (returns null if no goal exists) */
  readGoal: (sessionID: string) => Promise<Goal | null>;
  /** Write a goal to storage (overwrites existing goal) */
  writeGoal: (sessionID: string, goal: Goal) => Promise<void>;
  /** Create a new active goal (shorthand for writeGoal) */
  createGoal: (
    sessionID: string,
    title: string,
    doneCondition: string,
    description?: string
  ) => Promise<Goal>;
  /** Mark a goal as completed */
  completeGoal: (sessionID: string) => Promise<Goal | null>;
  /** Validate a completed goal (agent approval step) */
  validateGoal: (sessionID: string) => Promise<Goal | null>;
  /** Get the current goal (alias for readGoal) */
  getGoal: (sessionID: string) => Promise<Goal | null>;
  /** Check if a session has an active (non-completed) goal */
  hasActiveGoal: (sessionID: string) => Promise<boolean>;
  /** Event handler for session events */
  handler: (input: { event: LoopEvent }) => Promise<void>;
  /** Cleanup session state */
  cleanup: () => Promise<void>;
}