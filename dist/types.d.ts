export interface ModelSpec {
  providerID: string
  modelID: string
}
export interface PromptPart {
  type: string
  text: string
  ignored?: boolean
}
export interface SessionInfo {
  id: string
  agent?: string
  model?: string | ModelSpec
  title?: string
  status?: {
    type: "idle" | "busy"
  }
}
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
export interface PluginContext {
  directory: string
  client: {
    readonly session: {
      readonly id: string
      get(opts: {
        path: {
          id: string
        }
      }): Promise<SessionInfo>
      messages(opts: {
        path: {
          id: string
        }
      }): Promise<
        Array<{
          info: MessageInfo
          parts: unknown[]
        }>
      >
      prompt(opts: {
        path: {
          id: string
        }
        body: {
          agent?: string
          model?: string | ModelSpec
          noReply?: boolean
          parts: Array<PromptPart>
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
      agent?: string
      model?: string | ModelSpec
    }
    [key: string]: unknown
  }
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
export interface TaskContinuationOptions {
  countdownSeconds?: number
  errorCooldownMs?: number
  toastDurationMs?: number
  agent?: string
  model?: string
  logFilePath?: string
}
//# sourceMappingURL=types.d.ts.map
