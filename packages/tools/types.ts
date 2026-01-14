/**
 * @agent-loop/tools
 * Shared types for all agent-loop plugins
 */

import type { createOpencodeClient } from "@opencode-ai/sdk";

/**
 * Plugin input context (minimal interface for plugin creation)
 */
export interface PluginInput {
  directory: string;
  client: ReturnType<typeof createOpencodeClient>;
  on?: ReturnType<typeof createOpencodeClient> extends { on: infer T } ? T : never;
  project?: unknown;
}

/**
 * Plugin hooks structure
 */
export interface PluginHooks {
  tools?: Array<{
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    handler: (args?: unknown) => Promise<unknown>;
  }>;
  event?: (event: { event: unknown }) => Promise<void>;
}

/**
 * Plugin function type
 */
export type Plugin = (input: PluginInput) => Promise<PluginHooks>;

/**
 * Goal status states
 */
export type GoalStatus = "active" | "completed" | "validated";

/**
 * Goal structure
 */
export interface Goal {
  id: string;
  sessionID: string;
  title: string;
  done_condition: string;
  description?: string;
  status: GoalStatus;
  created_at: string;
  completed_at?: string;
  validated_at?: string;
}

/**
 * Goal management interface
 */
export interface GoalManagement {
  createGoal(
    sessionID: string,
    title: string,
    done_condition: string,
    description?: string
  ): Promise<Goal>;
  getGoal(sessionID: string): Promise<Goal | null>;
  completeGoal(sessionID: string): Promise<Goal | null>;
  validateGoal(sessionID: string): Promise<Goal | null>;
  checkPendingValidation(sessionID: string): Promise<boolean>;
  clearPendingValidation(sessionID: string): Promise<void>;
  cleanup(): Promise<void>;
  handler(event: { event: unknown }): Promise<void>;
}

/**
 * Logger interface
 */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/**
 * Log levels
 */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

/**
 * Session context for tracking agent/model
 */
export interface SessionContext {
  agent?: string;
  model?: { providerID: string; modelID: string };
}
