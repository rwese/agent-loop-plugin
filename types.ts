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
    info?: {
      id?: string
      sessionID?: string
      role?: string
      agent?: string
      model?: string | ModelSpec
    }
    /** Additional event properties */
    [key: string]: unknown
  }
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
  /** Goal management instance for goal-aware continuation */
  goalManagement?: GoalManagement
}

/** Configuration options for task continuation plugin (compatibility alias) */
export interface TaskContinuationOptions {
  /** Seconds to wait before auto-continuation (default: 2) */
  countdownSeconds?: number
  /** Cooldown period in ms after errors (default: 3000) */
  errorCooldownMs?: number
  /** Toast notification duration in ms (default: 900) */
  toastDurationMs?: number
  /** Agent name for continuation prompts */
  agent?: string
  /** Model name for continuation prompts */
  model?: string
  /** Path to log file for debugging */
  logFilePath?: string
  /** Goal management instance for goal-aware continuation */
  goalManagement?: GoalManagement
}

/** Public interface returned by createTaskContinuation */
export interface TaskContinuation {
  /** Event handler for session events */
  handler: (input: { event: LoopEvent }) => Promise<void>
  /** Mark a session as recovering (pauses auto-continuation) */
  markRecovering: (sessionID: string) => void
  /** Mark recovery as complete (resumes auto-continuation) */
  markRecoveryComplete: (sessionID: string) => void
  /** Cancel any pending continuation for a session and clear related state */
  cancel: (sessionID: string) => void
  /** Cleanup session state */
  cleanup: () => Promise<void>
}

export interface PromptCall {
  body: {
    agent?: string
    model?: string
    parts: Array<{
      ignored?: boolean
      text: string
    }>
  }
}

// ============================================================================
// Goal Management Types
// ============================================================================

/**
 * Represents a goal for the agent loop session.
 * Only one goal exists per session - new goal_set overwrites existing.
 */
export interface Goal {
  /** Title of the goal */
  title: string
  /** Optional detailed description of the goal */
  description?: string
  /** String description of what constitutes goal completion */
  done_condition: string
  /** Current status of the goal */
  status: "active" | "completed"
  /** ISO timestamp when the goal was created */
  created_at: string
  /** ISO timestamp when the goal was completed, null if not completed */
  completed_at: string | null
}

/** Path to the goals storage directory */
export const GOALS_BASE_PATH = "~/.local/share/opencode/plugin/agent-loop"

/** Filename for the goal JSON file */
export const GOAL_FILENAME = "goal.json"

/** Configuration options for goal management plugin */
export interface GoalManagementOptions {
  /** Custom base path for goal storage (defaults to standard OpenCode path) */
  goalsBasePath?: string
}

/** Public interface returned by createGoalManagement */
export interface GoalManagement {
  /** Read the current goal for a session (returns null if no goal exists) */
  readGoal: (sessionID: string) => Promise<Goal | null>
  /** Write a goal to storage (overwrites existing goal) */
  writeGoal: (sessionID: string, goal: Goal) => Promise<void>
  /** Create a new active goal (shorthand for writeGoal) */
  createGoal: (
    sessionID: string,
    title: string,
    doneCondition: string,
    description?: string
  ) => Promise<Goal>
  /** Mark a goal as completed */
  completeGoal: (sessionID: string) => Promise<Goal | null>
  /** Get the current goal (alias for readGoal) */
  getGoal: (sessionID: string) => Promise<Goal | null>
  /** Check if a session has an active (non-completed) goal */
  hasActiveGoal: (sessionID: string) => Promise<boolean>
  /** Event handler for session events */
  handler: (input: { event: LoopEvent }) => Promise<void>
  /** Cleanup session state */
  cleanup: () => Promise<void>
}
