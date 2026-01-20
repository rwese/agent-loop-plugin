/**
 * @agent-loop/tools
 * Shared types for all agent-loop plugins
 */

/**
 * Plugin input context (minimal interface for plugin creation)
 */
export interface PluginInput {
  directory: string;
  client: {
    session: {
      get: (args: { path: { id: string } }) => Promise<{ data?: { id: string } }>;
      todo: (args: { path: { id: string } }) => Promise<unknown>;
      prompt: (args: { path: { id: string }; body: { agent?: string; model?: { providerID: string; modelID: string }; parts: Array<{ type: string; text: string }> }; query?: { directory?: string } }) => Promise<void>;
      messages: (args: { path: { id: string } }) => Promise<unknown>;
    };
    tui: {
      showToast: (args: { body: { title: string; message: string; variant: string; duration: number } }) => Promise<void>;
    };
  };
  on?: (event: string, handler: (data: unknown) => void) => void;
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
