/**
 * TypeScript definitions for Agent Loop Plugin
 *
 * These types provide IDE support for developing OpenCode plugins using the Agent Loop Plugin.
 */

import type { PluginContext, LoopEvent } from "../../index.js"
import type { TaskLoop, IterationLoop } from "../../index.js"

/**
 * Plugin context interface for Agent Loop Plugin
 */
export interface AgentLoopPluginContext extends PluginContext {
  /**
   * Register an event handler
   */
  on(event: string, handler: (event: LoopEvent) => Promise<void>): void
}

/**
 * Configuration options for the Agent Loop Plugin
 */
export interface AgentLoopPluginOptions {
  /**
   * Seconds to wait before auto-continuing (default: 3)
   */
  countdownSeconds?: number

  /**
   * Cooldown period in ms after errors (default: 5000)
   */
  errorCooldownMs?: number

  /**
   * Toast notification duration in ms (default: 1000)
   */
  toastDurationMs?: number

  /**
   * Subagent name for help/feedback (default: "advisor")
   */
  helpAgent?: string

  /**
   * Agent name to use when prompting
   */
  agent?: string

  /**
   * Model name to use when prompting
   */
  model?: string

  /**
   * Log level (default: "info")
   */
  logLevel?: "silent" | "error" | "warn" | "info" | "debug"

  /**
   * Default max iterations for iteration loop (default: 50)
   */
  maxIterations?: number
}

/**
 * Result of starting an iteration loop
 */
export interface StartIterationLoopResult {
  success: boolean
  message?: string
  error?: string
}

/**
 * Result of completing an iteration loop
 */
export interface CompleteIterationLoopResult {
  success: boolean
  message?: string
  iterations?: number
}

/**
 * Status of the iteration loop
 */
export interface IterationLoopStatus {
  active: boolean
  iteration?: number
  max_iterations?: number
  completion_marker?: string
  started_at?: string
  task?: string
  message?: string
}

/**
 * Return type of the Agent Loop Plugin
 */
export interface AgentLoopPluginResult {
  /**
   * Event handler for session events
   */
  event: (event: LoopEvent) => Promise<void>

  /**
   * Tool implementations for iteration loop control
   */
  tool: {
    iteration_loop_start: {
      description: string
      parameters: {
        type: "object"
        properties: {
          task: {
            type: "string"
            description: string
          }
          maxIterations?: {
            type: "number"
            description: string
            default: number
          }
        }
        required: string[]
      }
      execute: (args: { task: string; maxIterations?: number }) => Promise<StartIterationLoopResult>
    }

    iteration_loop_complete: {
      description: string
      parameters: {
        type: "object"
        properties: {
          summary?: {
            type: "string"
            description: string
          }
        }
      }
      execute: (args: { summary?: string }) => Promise<CompleteIterationLoopResult>
    }

    iteration_loop_cancel: {
      description: string
      parameters: {
        type: "object"
        properties: Record<string, never>
      }
      execute: () => Promise<{ success: boolean; message: string }>
    }

    iteration_loop_status: {
      description: string
      parameters: {
        type: "object"
        properties: Record<string, never>
      }
      execute: () => Promise<IterationLoopStatus>
    }
  }

  /**
   * Direct access to loop instances
   */
  loops: {
    task: TaskLoop
    iteration: IterationLoop
  }

  /**
   * Start an iteration loop manually
   */
  startIterationLoop: (
    sessionID: string,
    task: string,
    options?: { maxIterations?: number }
  ) => boolean

  /**
   * Cancel active iteration loop
   */
  cancelIterationLoop: (sessionID: string) => boolean

  /**
   * Get iteration loop state
   */
  getIterationLoopState: () => ReturnType<IterationLoop["getState"]>

  /**
   * Pause task loop during error recovery
   */
  pauseTaskLoop: (sessionID: string) => void

  /**
   * Resume task loop after recovery
   */
  resumeTaskLoop: (sessionID: string) => void

  /**
   * Clean up task loop session state
   */
  cleanupTaskLoop: (sessionID: string) => void
}

/**
 * Agent Loop Plugin function
 *
 * Creates an OpenCode plugin that provides task continuation and iteration loop mechanisms.
 *
 * @param ctx - OpenCode plugin context
 * @param options - Optional configuration options
 * @returns Plugin hooks for event handling and tools
 *
 * @example
 * ```typescript
 * import { AgentLoopPlugin } from "agent-loop-plugin/plugin"
 *
 * export default function myPlugin(ctx) {
 *   const plugin = AgentLoopPlugin(ctx)
 *
 *   ctx.on("event", plugin.event)
 *
 *   return plugin
 * }
 * ```
 */
export declare function AgentLoopPlugin(
  ctx: AgentLoopPluginContext,
  options?: AgentLoopPluginOptions
): Promise<AgentLoopPluginResult>

export default AgentLoopPlugin
