/**
 * @agent-loop/tools
 * Session context management for tracking agent/model across messages
 * This module syncs with src/session-context.ts for consistency.
 */

import type { PluginInput, SessionContext } from "./types.js";

// Import the singleton from src/session-context for synchronization
import { sessionContext } from "../../src/session-context.js";

/**
 * Session context cache - mirrors src/session-context for compatibility
 */
const sessionContexts = new Map<string, SessionContext>();

/**
 * Update session context with agent/model info from a message
 */
export function updateContext(
  sessionID: string,
  context: Partial<SessionContext>
): void {
  const existing = sessionContexts.get(sessionID) || {};
  sessionContexts.set(sessionID, { ...existing, ...context });
}

/**
 * Get session context
 */
export function getContext(sessionID: string): SessionContext {
  return sessionContexts.get(sessionID) || {};
}

/**
 * Initialize session context for a plugin input
 * This clears all existing contexts to ensure test isolation
 */
export function initSessionContext(_input: PluginInput): void {
  // Clear contexts in both stores for test isolation
  sessionContexts.clear();
  sessionContext.clearAll();
}

/**
 * Clear session context
 */
export function clearContext(sessionID: string): void {
  sessionContexts.delete(sessionID);
  sessionContext.clearContext(sessionID);
}

/**
 * Clear all session contexts
 */
export function clearAllContexts(): void {
  sessionContexts.clear();
  sessionContext.clearAll();
}
