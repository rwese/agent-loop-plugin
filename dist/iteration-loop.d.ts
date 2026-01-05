import type { PluginContext, IterationLoopState, IterationLoopOptions, LoopEvent, CompleteLoopResult } from "./types.js";
export interface ProcessPromptResult {
    shouldIntercept: boolean;
    modifiedPrompt: string;
}
export interface IterationLoop {
    handler: (input: {
        event: LoopEvent;
    }) => Promise<void>;
    startLoop: (sessionID: string, prompt: string, options?: {
        maxIterations?: number;
    }) => Promise<boolean>;
    cancelLoop: (sessionID: string) => boolean;
    completeLoop: (sessionID: string, summary?: string) => CompleteLoopResult;
    getState: () => IterationLoopState | null;
    processPrompt: (sessionID: string, prompt: string) => Promise<ProcessPromptResult>;
}
export declare function createIterationLoop(ctx: PluginContext, options?: IterationLoopOptions): IterationLoop;
//# sourceMappingURL=iteration-loop.d.ts.map