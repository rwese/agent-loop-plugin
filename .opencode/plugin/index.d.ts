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

/** Minimal plugin context interface required for task continuation */
export interface PluginContext {
  /** Working directory for the session */
  directory: string
  /** Client API for interacting with OpenCode */
  client: {
    /** Session API */
    session: {
      /** Send a prompt to a session */
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
      /** Get todos for a session */
      todo(opts: { path: { id: string } }): Promise<Todo[] | { data: Todo[] }>
    }
    /** UI API */
    tui: {
      /** Show a toast notification in the UI */
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

/**
 * Create a task continuation plugin
 *
 * Automatically continues sessions when incomplete tasks remain.
 *
 * @param ctx - OpenCode plugin context
 * @param options - Optional configuration options
 * @returns TaskContinuation interface for event handling and state management
 *
 * @example
 * ```typescript
 * import { createTaskContinuation } from "agent-loop-plugin/plugin"
 *
 * export default function myPlugin(ctx) {
 *   const taskContinuation = createTaskContinuation(ctx, {
 *     countdownSeconds: 3,
 *     errorCooldownMs: 5000,
 *   })
 *
 *   ctx.on("event", taskContinuation.handler)
 *
 *   return { taskContinuation }
 * }
 * ```
 */
export declare function createTaskContinuation(
  ctx: PluginContext,
  options?: TaskContinuationOptions
): TaskContinuation

export default createTaskContinuation
