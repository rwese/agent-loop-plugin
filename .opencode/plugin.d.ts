/**
 * TypeScript definitions for Task Continuation Plugin
 *
 * These types provide IDE support for developing OpenCode plugins using the Task Continuation Plugin.
 */

/** Represents a single todo/task item */
export interface Todo {
  /** Unique todo identifier */
  id: string
  /** Description of the task */
  content: string
  /** Current status of the task */
  status: "pending" | "in_progress" | "completed" | "cancelled"
  /** Priority level of the task */
  priority: string
}

/** Represents an event from the OpenCode plugin system */
export interface LoopEvent {
  /** Type of event (e.g., "session.idle", "session.error") */
  type: string
  /** Event properties containing session and event-specific data */
  properties?: {
    /** Session ID this event relates to */
    sessionID?: string
    /** Error object (for error events) */
    error?: unknown
    /** Message info (for message events) */
    info?: { id?: string; sessionID?: string; role?: string }
    /** Additional event properties */
    [key: string]: unknown
  }
}

/** OpenCode client API */
export interface PluginClient {
  session: {
    prompt(opts: {
      path: { id: string }
      body: {
        agent?: string
        model?: string
        noReply?: boolean
        parts: Array<{ type: string; text: string; ignored?: boolean }>
      }
      query?: { directory: string }
    }): Promise<void>
    todo(opts: { path: { id: string } }): Promise<Todo[] | { data: Todo[] }>
  }
  tui: {
    showToast(opts: {
      body: {
        title: string
        message: string
        variant: "info" | "success" | "warning" | "error"
        duration: number
      }
    }): Promise<void>
  }
}

/** Plugin context passed to main function */
export interface PluginContext {
  directory: string
  client: PluginClient
}

/** Configuration options for the task continuation plugin */
export interface TaskContinuationOptions {
  /** Seconds to wait before auto-continuing (default: 2) */
  countdownSeconds?: number
  /** Cooldown period in ms after errors (default: 3000) */
  errorCooldownMs?: number
  /** Toast notification duration in ms (default: 900) */
  toastDurationMs?: number
  /** Agent name to use when prompting */
  agent?: string
  /** Model name to use when prompting */
  model?: string
}

/** Public interface returned by createTaskContinuation */
export interface TaskContinuation {
  /** Event handler for session events */
  handler: (input: { event: LoopEvent }) => Promise<void>
  /** Mark session as recovering (pauses continuation) */
  markRecovering: (sessionID: string) => void
  /** Mark recovery as complete (resumes continuation) */
  markRecoveryComplete: (sessionID: string) => void
  /** Clean up session state */
  cleanup: (sessionID: string) => void
}

/** Return type of createTaskContinuation */
export interface TaskContinuationFactory {
  (ctx: PluginContext, options?: TaskContinuationOptions): TaskContinuation
}

/** Result of the main plugin function */
export interface PluginResult {
  /** Event handler for OpenCode events */
  event: (input: { event: LoopEvent }) => Promise<void>
  /** Direct access to task continuation methods */
  taskContinuation: {
    markRecovering: (sessionID: string) => void
    markRecoveryComplete: (sessionID: string) => void
    cleanup: (sessionID: string) => void
  }
}

/**
 * OpenCode Plugin main function
 *
 * Creates a plugin that automatically continues sessions when incomplete tasks remain.
 *
 * @param context - OpenCode plugin context with directory and client
 * @returns Plugin result with event handler and task continuation methods
 *
 * @example
 * ```typescript
 * import { main } from "agent-loop-plugin/plugin"
 *
 * export { main }
 * export default main
 * ```
 */
export declare function main(context: PluginContext): Promise<PluginResult>

export default main
