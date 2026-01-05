export interface IterationLoopTagResult {
  found: boolean
  task?: string
  maxIterations?: number
  marker?: string
  cleanedPrompt: string
}
export declare function parseIterationLoopTag(prompt: string): IterationLoopTagResult
export declare function buildIterationStartPrompt(
  task: string,
  maxIterations: number,
  _marker: string,
  userPrompt?: string
): string
//# sourceMappingURL=prompt-parser.d.ts.map
