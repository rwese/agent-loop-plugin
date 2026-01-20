/**
 * Session Context Manager
 *
 * Centralized session context management for OpenCode plugins.
 * Provides a single source of truth for agent/model tracking and ensures
 * consistent prompt() calls with proper context parameters.
 *
 * ## Usage for Plugin Authors
 *
 * 1. Initialize during plugin setup:
 *    ```typescript
 *    import { initSessionContext } from "./session-context.js";
 *    initSessionContext(ctx);
 *    ```
 *
 * 2. Track context from chat.message events:
 *    ```typescript
 *    import { sessionContext } from "./session-context.js";
 *    sessionContext.updateContext(sessionID, { agent, model });
 *    ```
 *
 * 3. Send prompts with automatic context:
 *    ```typescript
 *    import { promptWithContext } from "./session-context.js";
 *    await promptWithContext({ sessionID, text: "Hello" });
 *    ```
 */

import type { PluginContext, ModelSpec } from "./types.js";

// ============================================================================
// Types
// ============================================================================
// Types
// ============================================================================

/**
 * Session context containing agent and model information.
 * This is the minimal context needed for proper prompt() calls.
 */
export interface SessionContext {
  /** Agent identifier (e.g., "orchestrator", "coder") */
  agent?: string;
  /** Model specification with provider and model IDs */
  model?: ModelSpec;
}

/**
 * Options for sending a prompt to a session.
 */
export interface PromptOptions {
  /** Session ID to send the prompt to */
  sessionID: string;
  /** Text content of the prompt */
  text: string;
  /** If true, the agent will not reply to this message */
  noReply?: boolean;
  /** If true, marks the message as synthetic (system-generated) */
  synthetic?: boolean;
  /** Working directory override for this prompt */
  directory?: string;
}

/**
 * Extended prompt options with explicit context override.
 * Use this when you need to force specific agent/model values.
 */
export interface PromptOptionsWithContext extends PromptOptions {
  /** Override the cached context with explicit values */
  contextOverride?: SessionContext;
}

/**
 * Result from fetching session context from messages.
 */
interface MessageContextResult {
  agent?: string;
  model?: ModelSpec;
  source: "messages";
}

// ============================================================================
// Session Context Manager
// ============================================================================

/**
 * Centralized manager for session context tracking and prompt building.
 *
 * This class maintains a cache of session contexts and provides methods
 * for sending prompts with the correct agent/model parameters.
 */
class SessionContextManager {
  private contexts = new Map<string, SessionContext>();
  private client: PluginContext["client"] | null = null;
  private directory: string | null = null;
  private initialized = false;

  /**
   * Initialize the manager with plugin context.
   * Must be called once during plugin setup.
   * Clears all existing contexts to ensure test isolation.
   */
  initialize(ctx: PluginContext): void {
    this.client = ctx.client;
    this.directory = ctx.directory ?? null;
    this.initialized = true;
    // Clear all contexts to ensure test isolation
    this.contexts.clear();
  }

  /**
   * Check if the manager has been initialized.
   */
  isInitialized(): boolean {
    return this.initialized && this.client !== null;
  }

  /**
   * Update session context from an event or message.
   * Call this whenever you receive session information (e.g., in chat.message handler).
   *
   * @param sessionID - The session to update
   * @param context - Partial context to merge with existing
   */
  updateContext(sessionID: string, context: Partial<SessionContext>): void {
    const existing = this.contexts.get(sessionID) || {};

    // Only update fields that are explicitly provided
    const updated: SessionContext = { ...existing };
    if (context.agent !== undefined) {
      updated.agent = context.agent;
    }
    if (context.model !== undefined) {
      updated.model = context.model;
    }

    this.contexts.set(sessionID, updated);
  }

  /**
   * Get cached context for a session.
   * Returns undefined if no context is cached.
   */
  getContext(sessionID: string): SessionContext | undefined {
    return this.contexts.get(sessionID);
  }

  /**
   * Check if we have cached context for a session.
   */
  hasContext(sessionID: string): boolean {
    const ctx = this.contexts.get(sessionID);
    return !!(ctx?.agent || ctx?.model);
  }

  /**
   * Fetch session context from the API.
   * Updates the cache on success.
   *
   * @param sessionID - The session to fetch context for
   * @param forceRefresh - If true, ignores cached value
   */
  async fetchContext(
    sessionID: string,
    forceRefresh = false
  ): Promise<SessionContext | undefined> {
    // Return cached if available and not forcing refresh
    if (!forceRefresh) {
      const cached = this.contexts.get(sessionID);
      if (cached?.agent || cached?.model) {
        return cached;
      }
    }

    if (!this.client) {
      return undefined;
    }

    try {
      // Try session.get first (most reliable)
      const sessionContext = await this.fetchFromSession(sessionID);
      if (sessionContext?.agent || sessionContext?.model) {
        this.contexts.set(sessionID, sessionContext);
        return sessionContext;
      }

      // Fall back to messages if session.get doesn't have context
      const messageContext = await this.fetchFromMessages(sessionID);
      if (messageContext?.agent || messageContext?.model) {
        const context: SessionContext = {
          agent: messageContext.agent,
          model: messageContext.model,
        };
        this.contexts.set(sessionID, context);
        return context;
      }
    } catch {
      // Silently fail
    }

    return undefined;
  }

  /**
   * Fetch context from session.get API.
   */
  private async fetchFromSession(
    sessionID: string
  ): Promise<SessionContext | undefined> {
    if (!this.client) return undefined;

    try {
      const session = await this.client.session.get({ path: { id: sessionID } });
      if (session.data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = session.data as any;
        const model = data.model;
        const context: SessionContext = {
          agent: data.agent,
          model: this.normalizeModel(model),
        };
        return context;
      }
    } catch {
      // Silently fail
    }
    return undefined;
  }

  /**
   * Fetch context from session messages (fallback).
   */
  private async fetchFromMessages(
    sessionID: string
  ): Promise<MessageContextResult | undefined> {
    if (!this.client) return undefined;

    try {
      const response = await this.client.session.messages({
        path: { id: sessionID },
      });
      if (response.data && Array.isArray(response.data)) {
        // Find most recent message with agent/model info
        for (let i = response.data.length - 1; i >= 0; i--) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const msg = response.data[i] as any;
          const info = msg.info || msg;
          if (info.agent || info.model) {
            return {
              agent: info.agent,
              model: this.normalizeModel(info.model),
              source: "messages",
            };
          }
        }
      }
    } catch {
      // Silently fail
    }
    return undefined;
  }

  /**
   * Normalize model to ModelSpec format.
   */
  private normalizeModel(
    model: unknown
  ): ModelSpec | undefined {
    if (!model) return undefined;
    if (typeof model === "string") return undefined; // String models not supported

    const m = model as { providerID?: string; modelID?: string };
    if (m.providerID && m.modelID) {
      return { providerID: m.providerID, modelID: m.modelID };
    }
    return undefined;
  }

  /**
   * Get context with automatic fetching if not cached.
   * This is the recommended way to get context before operations.
   *
   * @param sessionID - The session to get context for
   * @param maxAttempts - Maximum fetch attempts (default: 3)
   * @param delayMs - Delay between retry attempts (default: 50)
   */
  async ensureContext(
    sessionID: string,
    maxAttempts = 3,
    delayMs = 50
  ): Promise<SessionContext | undefined> {
    // Check cache first
    const cached = this.contexts.get(sessionID);
    if (cached?.agent || cached?.model) {
      return cached;
    }

    // Attempt to fetch with retries
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const context = await this.fetchContext(sessionID, true);
      if (context?.agent || context?.model) {
        return context;
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return undefined;
  }

  /**
   * Send a prompt to a session with proper agent/model context.
   *
   * This is the canonical way to call session.prompt(). It:
   * - Uses cached context if available
   * - Fetches context from API if needed
   * - Ensures agent and model are always included
   *
   * @param options - Prompt configuration
   */
  async prompt(options: PromptOptionsWithContext): Promise<void> {
    if (!this.client) {
      throw new Error(
        "Session context manager not initialized. Call initSessionContext(ctx) first."
      );
    }

    const { sessionID, text, noReply, synthetic, directory, contextOverride } =
      options;

    // Determine context: cached > fetched > override (fallback)
    let context: SessionContext | undefined = await this.ensureContext(sessionID);

    // If no context found from cache/API, use override as fallback
    if (!context?.agent && !context?.model && (contextOverride?.agent || contextOverride?.model)) {
      context = contextOverride;
    }

    // Build the parts array with literal type
    const parts = [
      {
        type: "text" as const,
        text,
        ...(synthetic && { synthetic: true }),
      },
    ];

    // Build query params
    const workdir = directory || this.directory;

    await this.client.session.prompt({
      path: { id: sessionID },
      body: {
        parts,
        ...(context?.agent && { agent: context.agent }),
        ...(context?.model && { model: context.model }),
        ...(noReply && { noReply: true }),
      },
      ...(workdir && { query: { directory: workdir } }),
    });
  }

  /**
   * Clear context for a specific session.
   * Call this when a session is deleted or cleaned up.
   */
  clearContext(sessionID: string): void {
    this.contexts.delete(sessionID);
  }

  /**
   * Clear all cached contexts.
   * Call this during plugin cleanup.
   */
  clearAll(): void {
    this.contexts.clear();
  }

  /**
   * Get statistics about cached contexts.
   * Useful for debugging and monitoring.
   */
  getStats(): { cachedSessions: number; initialized: boolean } {
    return {
      cachedSessions: this.contexts.size,
      initialized: this.initialized,
    };
  }
}

// ============================================================================
// Singleton Instance and Convenience Functions
// ============================================================================

/**
 * Singleton instance of the session context manager.
 *
 * Use this directly when you need fine-grained control, or use
 * the convenience functions below for common operations.
 */
export const sessionContext = new SessionContextManager();

/**
 * Initialize session context manager with plugin context.
 *
 * Call this once during plugin initialization:
 * ```typescript
 * export const myPlugin: Plugin = async (ctx) => {
 *   initSessionContext(ctx);
 *   // ...rest of plugin setup
 * };
 * ```
 */
export function initSessionContext(ctx: PluginContext): void {
  sessionContext.initialize(ctx);
}

/**
 * Send a prompt with automatic context handling.
 *
 * This is the recommended way to send prompts in plugins:
 * ```typescript
 * await promptWithContext({
 *   sessionID: "session-123",
 *   text: "Continue with the task",
 *   noReply: true,  // optional
 *   synthetic: true, // optional
 * });
 * ```
 */
export async function promptWithContext(
  options: PromptOptionsWithContext
): Promise<void> {
  return sessionContext.prompt(options);
}

/**
 * Get session context, fetching from API if needed.
 *
 * @deprecated Use sessionContext.ensureContext() instead for retry support.
 * This function is kept for backwards compatibility.
 */
export async function getSessionContext(
  client: PluginContext["client"],
  sessionID: string
): Promise<SessionContext | undefined> {
  // If manager is initialized, use it
  if (sessionContext.isInitialized()) {
    return sessionContext.ensureContext(sessionID);
  }

  // Fallback for uninitialized state (backwards compatibility)
  try {
    const session = await client.session.get({ path: { id: sessionID } });
    if (session.data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = session.data as any;
      const model = data.model;
      return {
        agent: data.agent,
        model:
          typeof model === "string"
            ? undefined
            : model
              ? { providerID: model.providerID, modelID: model.modelID }
              : undefined,
      };
    }
  } catch {
    // Silently fail
  }
  return undefined;
}
