/**
 * Agent Loop Plugin TypeScript type definitions
 */

export interface AgentLoopPluginOptions {
  directory: string
  client: {
    session: {
      prompt: (opts: any) => Promise<any>
      todo: (opts: any) => Promise<any>
      message: (opts: any) => Promise<any>
    }
    tui: {
      showToast: (opts: any) => Promise<void>
    }
  }
}

export interface AgentLoopPluginResult {
  tool: {
    iteration_loop_start: {
      description: string
      args: {
        task: { schema: string }
        maxIterations?: { schema: number }
      }
      execute: (args: any, toolCtx: any) => Promise<string>
    }
    iteration_loop_complete: {
      description: string
      args: {
        summary?: { schema: string }
      }
      execute: (args: any, toolCtx: any) => Promise<string>
    }
    iteration_loop_cancel: {
      description: string
      args: Record<string, never>
      execute: (args: any, toolCtx: any) => Promise<string>
    }
    iteration_loop_status: {
      description: string
      args: Record<string, never>
      execute: () => Promise<string>
    }
  }
  event: (event: any) => Promise<void>
  loops: {
    task: any
    iteration: any
  }
  startIterationLoop: (sessionID: string, prompt: string, options?: any) => Promise<boolean>
  cancelIterationLoop: (sessionID: string) => Promise<boolean>
  getIterationLoopState: () => any
  pauseTaskLoop: (sessionID: string) => void
  resumeTaskLoop: (sessionID: string) => void
  cleanupTaskLoop: (sessionID: string) => void
  sendStatusMessage: (sessionID: string, message: string) => Promise<void>
}

export declare const AgentLoopPlugin: (
  options: AgentLoopPluginOptions
) => Promise<AgentLoopPluginResult>
export declare const main: typeof AgentLoopPlugin
