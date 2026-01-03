/** Shared type definitions for agent loop mechanisms */

/** A single part of a message (e.g., text, image, etc.) */
export interface MessagePart {
  /** Unique identifier for the message part */
  id: string
  /** Type of message part (e.g., "text", "image") */
  type: string
  /** Text content if type is "text" */
  text?: string
  /** Additional properties */
  [key: string]: unknown
}

/** A message in the conversation history */
export interface Message {
  /** Message metadata */
  info: {
    /** Unique message identifier */
    id: string
    /** Session this message belongs to */
    sessionID: string
    /** Role of the message sender (user or assistant) */
    role: "user" | "assistant"
    /** Additional metadata */
    [key: string]: unknown
  }
  /** Content parts of the message */
  parts: MessagePart[]
}

/** Minimal plugin context interface required for agent loops */
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

      /** Get messages for a session (used for completion marker detection) */
      message?(opts: {
        path: { id: string }
        query?: { limit?: number }
      }): Promise<Message[] | { data: Message[] }>
    }

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
    /** Path to the transcript file (when available) */
    transcriptPath?: string
    /** Error object (for error events) */
    error?: unknown
    /** Message info (for message events) */
    info?: { id?: string; sessionID?: string; role?: string }
    /** Additional event properties */
    [key: string]: unknown
  }
}

/** Persisted state for the iteration loop */
export interface IterationLoopState {
  /** Whether the loop is currently active */
  active: boolean
  /** Current iteration number (1-indexed) */
  iteration: number
  /** Maximum iterations before auto-stopping */
  max_iterations: number
  /** Completion marker the AI should output */
  completion_marker: string
  /** When the loop was started (ISO timestamp) */
  started_at: string
  /** Original task prompt */
  prompt: string
  /** Session ID this loop belongs to (optional) */
  session_id?: string
}

/** Log level for controlling output verbosity */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug"

/** Logger interface for consistent logging across the codebase */
export interface Logger {
  /** Log a debug message */
  debug(message: string, data?: Record<string, unknown>): void
  /** Log an info message */
  info(message: string, data?: Record<string, unknown>): void
  /** Log a warning message */
  warn(message: string, data?: Record<string, unknown>): void
  /** Log an error message */
  error(message: string, data?: Record<string, unknown>): void
}

/** Information passed to the onCountdownStart callback */
export interface CountdownCallbackInfo {
  /** Session ID for the countdown */
  sessionID: string
  /** Number of incomplete tasks */
  incompleteCount: number
  /** Total number of tasks */
  totalCount: number
  /** Function to call when countdown completes to inject continuation */
  inject: () => Promise<void>
}

/** Information passed to the onContinue callback when iteration continues */
export interface IterationContinueCallbackInfo {
  /** Session ID for this iteration */
  sessionID: string
  /** Current iteration number */
  iteration: number
  /** Maximum iterations allowed */
  maxIterations: number
  /** Completion marker to look for */
  marker: string
  /** Original task prompt */
  prompt: string
  /** Function to inject continuation prompt directly */
  inject: () => Promise<void>
}

/** Configuration options for creating an Iteration Loop */
export interface IterationLoopOptions {
  /** Default maximum iterations if not specified in startLoop() or prompt tag */
  defaultMaxIterations?: number
  /** Custom path for the state file (relative to session directory) */
  stateFilePath?: string
  /** Custom logger instance */
  logger?: Logger
  /** Minimum log level to output */
  logLevel?: LogLevel
  /** Agent name to use when prompting */
  agent?: string
  /** Model name to use when prompting */
  model?: string
  /** Custom path for output log file */
  outputFilePath?: string
  /** Callback invoked when iteration continues (allows plugin-controlled injection) */
  onContinue?: (info: IterationContinueCallbackInfo) => void
}

/** Configuration options for creating a Task Loop */
export interface TaskLoopOptions {
  /** Seconds to wait before auto-continuing (default: 2) */
  countdownSeconds?: number
  /** Cooldown period in ms after errors before continuing again (default: 3000) */
  errorCooldownMs?: number
  /** Toast notification duration in ms (default: 900) */
  toastDurationMs?: number
  /** Custom logger instance */
  logger?: Logger
  /** Minimum log level to output */
  logLevel?: LogLevel
  /** Agent name to use when prompting */
  agent?: string
  /** Model name to use when prompting */
  model?: string
  /** Custom path for output log file */
  outputFilePath?: string
  /** Subagent name for help/feedback requests */
  helpAgent?: string
  /** Callback invoked when countdown starts (allows plugin-controlled timing) */
  onCountdownStart?: (info: CountdownCallbackInfo) => void
}
