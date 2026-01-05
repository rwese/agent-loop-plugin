export interface PluginContext {
  directory: string
  client: {
    session: {
      prompt(opts: {
        path: {
          id: string
        }
        body: {
          agent?: string
          model?: string
          noReply?: boolean
          parts: Array<{
            type: string
            text: string
            ignored?: boolean
          }>
        }
        query?: {
          directory: string
        }
      }): Promise<void>
      todo(opts: {
        path: {
          id: string
        }
      }): Promise<
        | Todo[]
        | {
            data: Todo[]
          }
      >
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
}
export interface Todo {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: string
}
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
export interface IterationLoopState {
  active: boolean
  iteration: number
  max_iterations: number
  completion_marker: string
  started_at: string
  prompt: string
  session_id?: string
}
export interface CompleteLoopResult {
  success: boolean
  iterations: number
  message: string
}
export interface AdvisorEvaluationResult {
  isComplete: boolean
  feedback: string
  missingItems?: string[]
  confidence?: number
}
export interface CompletionEvaluatorInfo {
  sessionID: string
  iteration: number
  maxIterations: number
  prompt: string
  transcript: string
  complete: (summary?: string) => CompleteLoopResult
  continueWithFeedback: (feedback: string, missingItems?: string[]) => Promise<void>
}
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug"
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}
export interface CountdownCallbackInfo {
  sessionID: string
  incompleteCount: number
  totalCount: number
  inject: () => Promise<void>
}
export interface IterationLoopOptions {
  defaultMaxIterations?: number
  stateFilePath?: string
  logger?: Logger
  logLevel?: LogLevel
  agent?: string
  model?: string
  outputFilePath?: string
  onEvaluator?: (info: CompletionEvaluatorInfo) => Promise<AdvisorEvaluationResult>
  getTranscript?: (sessionID: string) => Promise<string>
}
export interface TaskLoopOptions {
  countdownSeconds?: number
  errorCooldownMs?: number
  toastDurationMs?: number
  logger?: Logger
  logLevel?: LogLevel
  agent?: string
  model?: string
  outputFilePath?: string
  helpAgent?: string
  onCountdownStart?: (info: CountdownCallbackInfo) => void
}
//# sourceMappingURL=types.d.ts.map
