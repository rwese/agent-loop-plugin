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

