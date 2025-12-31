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
          model?: string
          noReply?: boolean
          parts: Array<{ type: string; text: string; ignored?: boolean }>
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

  /** Custom logger instance (defaults to console) */
  logger?: Logger

  /** Log level for filtering output (defaults to 'info') */
  logLevel?: LogLevel

  /** Agent to use for continuation prompts */
  agent?: string

  /** Model to use for continuation prompts */
  model?: string

  /** File path to write loop output/logs (relative to directory) */
  outputFilePath?: string
}

/**
 * Log level for filtering log output
 */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug"

/**
 * Logger interface for structured logging
 */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

/**
 * Callback info passed when countdown should start
 */
export interface CountdownCallbackInfo {
  sessionID: string
  incompleteCount: number
  totalCount: number
  /** Call this function to inject the continuation prompt */
  inject: () => Promise<void>
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

  /** Custom logger instance (defaults to console) */
  logger?: Logger

  /** Log level for filtering output (defaults to 'info') */
  logLevel?: LogLevel

  /** Agent to use for continuation prompts */
  agent?: string

  /** Model to use for continuation prompts */
  model?: string

  /** File path to write loop output/logs (relative to directory) */
  outputFilePath?: string

  /**
   * Callback when countdown should start.
   * If provided, the library will NOT handle timers - the plugin must call inject() after countdown.
   * If not provided, the library uses internal setTimeout (may not work in all environments).
   */
  onCountdownStart?: (info: CountdownCallbackInfo) => void
}
