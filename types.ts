/**
 * Shared type definitions for agent loop mechanisms
 */

/**
 * Minimal plugin context interface required for agent loops
 */
export interface PluginContext {
  /** Working directory for the session */
  directory: string

  /** Client API for interacting with OpenCode */
  client: {
    session: {
      /** Send a prompt to a session */
      prompt(opts: {
        path: { id: string }
        body: {
          agent?: string
          parts: Array<{ type: string; text: string }>
        }
        query?: { directory: string }
      }): Promise<void>

      /** Get todos for a session */
      todo(opts: { path: { id: string } }): Promise<Todo[] | { data: Todo[] }>
    }

    tui: {
      /** Show a toast notification */
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

/**
 * Todo item structure
 */
export interface Todo {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: string
}

/**
 * Event structure for loop hooks
 */
export interface LoopEvent {
  type: string
  properties?: {
    sessionID?: string
    transcriptPath?: string
    error?: unknown
    info?: {
      id?: string
      sessionID?: string
      role?: string
    }
    [key: string]: unknown
  }
}

/**
 * State for Iteration Loop (iteration-based loop with completion marker)
 */
export interface IterationLoopState {
  active: boolean
  iteration: number
  max_iterations: number
  completion_marker: string
  started_at: string
  prompt: string
  session_id?: string
}

/**
 * Options for configuring Iteration Loop
 */
export interface IterationLoopOptions {
  /** Default maximum iterations */
  defaultMaxIterations?: number

  /** Default completion marker string */
  defaultCompletionMarker?: string

  /** Custom state file path (relative to directory) */
  stateFilePath?: string
}

/**
 * Options for configuring Task Loop
 */
export interface TaskLoopOptions {
  /** Countdown duration in seconds before auto-continuing */
  countdownSeconds?: number

  /** Error cooldown duration in milliseconds */
  errorCooldownMs?: number

  /** Toast notification duration in milliseconds */
  toastDurationMs?: number
}
