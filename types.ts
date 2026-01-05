/** Shared type definitions for agent loop mechanisms */

/** Model specification following OpenCode SDK format */
export interface ModelSpec {
  /** Provider ID (e.g., "anthropic", "openai") */
  providerID: string
  /** Model ID (e.g., "claude-3-5-sonnet-20241022") */
  modelID: string
}

/** Message part for prompting */
export interface PromptPart {
  type: string
  text: string
  ignored?: boolean
}

/** Session information from OpenCode SDK */
export interface SessionInfo {
  id: string
  agent?: string
  model?: string | ModelSpec
  title?: string
  status?: {
    type: "idle" | "busy"
  }
}

/** Message information from OpenCode SDK */
export interface MessageInfo {
  id: string
  sessionID: string
  agent?: string
  model?: string | ModelSpec
  role: "user" | "assistant"
  time?: {
    created: number
    completed?: number
  }
  finish?: string
}

/** Minimal plugin context interface required for agent loops */
export interface PluginContext {
  /** Working directory for the session */
  directory: string

  /** Client API for interacting with OpenCode */
  client: {
    /** Get current session ID */
    readonly session: {
      /** Get current session ID */
      readonly id: string

      /** Get session details including agent and model */
      get(opts: { path: { id: string } }): Promise<SessionInfo>

      /** List messages in a session, returns most recent first */
      messages(opts: {
        path: { id: string }
      }): Promise<Array<{ info: MessageInfo; parts: unknown[] }>>

      /** Send a prompt to a session */
      prompt(opts: {
        path: { id: string }
        body: {
          agent?: string
          model?: string | ModelSpec
          noReply?: boolean
          parts: Array<PromptPart>
        }
        query?: { directory: string }
      }): Promise<void>

      /** Get todos for a session */
      todo(opts: { path: { id: string } }): Promise<Todo[] | { data: Todo[] }>
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
  /** Agent name for this loop (optional - preserves the agent used when starting) */
  agent?: string
}

/** Result of completing an iteration loop */
export interface CompleteLoopResult {
  /** Whether the loop was successfully completed */
  success: boolean
  /** Number of iterations completed */
  iterations: number
  /** Summary message */
  message: string
}

/** Result from the Advisor evaluation */
export interface AdvisorEvaluationResult {
  /** Whether the task is complete */
  isComplete: boolean
  /** Detailed feedback about progress */
  feedback: string
  /** Specific issues or missing items found */
  missingItems?: string[]
  /** Confidence level of the evaluation (0-1) */
  confidence?: number
}

/** Information passed to the completion evaluator callback */
export interface CompletionEvaluatorInfo {
  /** Session ID for this iteration */
  sessionID: string
  /** Current iteration number */
  iteration: number
  /** Maximum iterations allowed */
  maxIterations: number
  /** Original task prompt */
  prompt: string
  /** Current session transcript */
  transcript: string
  /** Function to complete the loop */
  complete: (summary?: string) => CompleteLoopResult
  /** Function to continue with feedback */
  continueWithFeedback: (feedback: string, missingItems?: string[]) => Promise<void>
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
  /** Callback invoked to evaluate if task is complete (uses Advisor pattern) */
  onEvaluator?: (info: CompletionEvaluatorInfo) => Promise<AdvisorEvaluationResult>
  /** Optional custom function to get session transcript for Advisor */
  getTranscript?: (sessionID: string) => Promise<string>
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
