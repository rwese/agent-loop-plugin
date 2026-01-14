/**
 * @agent-loop/tools
 * Session context management for tracking agent/model across messages
 */

import type { PluginInput, SessionContext } from "./types.js";

/**
 * Session context cache
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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getContext(sessionID: string): SessionContext {
  return sessionContexts.get(sessionID) || {};
}

/**
 * @eslint-disable-next-line @typescript-eslint/no-unused-vars
 */
export function initSessionContext(_input: PluginInput): void {
  // Context is initialized - real session ID comes from events
  // The session context will be populated as messages arrive
}

/**
 * Clear session context
 */
export function clearContext(sessionID: string): void {
  sessionContexts.delete(sessionID);
}
