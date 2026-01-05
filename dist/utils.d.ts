import type { IterationLoopState, Logger, LogLevel } from "./types.js"
export interface FrontmatterResult<T = Record<string, unknown>> {
  data: T
  body: string
}
export declare function parseFrontmatter<T = Record<string, unknown>>(
  content: string
): FrontmatterResult<T>
export declare function isAbortError(error: unknown): boolean
export declare function generateCodename(): string
export declare function getStateFilePath(directory: string, customPath?: string): string
export declare function readLoopState(
  directory: string,
  customPath?: string
): IterationLoopState | null
export declare function writeLoopState(
  directory: string,
  state: IterationLoopState,
  customPath?: string
): boolean
export declare function clearLoopState(directory: string, customPath?: string): boolean
export declare function incrementIteration(
  directory: string,
  customPath?: string
): IterationLoopState | null
export declare function createLogger(customLogger?: Partial<Logger>, logLevel?: LogLevel): Logger
export interface SendIgnoredMessageOptions {
  agent?: string
  model?: string
}
export declare function sendIgnoredMessage(
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
      }): Promise<void>
    }
  },
  sessionID: string,
  text: string,
  logger?: Logger,
  options?: SendIgnoredMessageOptions
): Promise<void>
export declare function getOutputFilePath(directory: string, customPath?: string): string
export declare function writeOutput(
  directory: string,
  message: string,
  data?: Record<string, unknown>,
  customPath?: string
): boolean
export declare function clearOutput(directory: string, customPath?: string): boolean
export declare function createFileLogger(
  directory: string,
  customPath?: string,
  logLevel?: LogLevel
): Logger
//# sourceMappingURL=utils.d.ts.map
