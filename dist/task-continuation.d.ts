interface ModelSpec {
  providerID: string
  modelID: string
}
interface SessionInfo {
  id: string
  agent?: string
  model?: string | ModelSpec
  title?: string
  status?: {
    type: "idle" | "busy"
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
export interface TaskContinuationOptions {
  countdownSeconds?: number
  errorCooldownMs?: number
  toastDurationMs?: number
  agent?: string
  model?: string | ModelSpec
  logFilePath?: string
  continuationPromptFile?: string
}
export interface TaskContinuation {
  handler: (input: { event: LoopEvent }) => Promise<void>
  markRecovering: (sessionID: string) => void
  markRecoveryComplete: (sessionID: string) => void
  cancel: (sessionID: string) => void
  cleanup: () => Promise<void>
}
interface PluginContext {
  directory: string
  client: {
    session: {
      get(opts: {
        path: {
          id: string
        }
      }): Promise<SessionInfo>
      prompt(opts: {
        path: {
          id: string
        }
        body: {
          agent?: string
          model?: string | ModelSpec
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
      messages(opts: {
        path: {
          id: string
        }
      }): Promise<
        Array<{
          info: {
            agent?: string
            model?: string | ModelSpec
            role?: string
            sessionID?: string
            id?: string
          }
          parts: unknown[]
        }>
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
export declare function createTaskContinuation(
  ctx: PluginContext,
  options?: TaskContinuationOptions
): TaskContinuation
export {}
//# sourceMappingURL=task-continuation.d.ts.map
