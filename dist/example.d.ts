import type { PluginContext, LoopEvent } from "./index.js";
export default function examplePlugin(ctx: PluginContext): {
    startIterationLoop: (sessionID: string, task: string, options?: {
        maxIterations?: number;
    }) => Promise<boolean>;
    cancelIterationLoop: (sessionID: string) => boolean;
    getIterationLoopState: () => import("./types.js").IterationLoopState | null;
    pauseTaskLoop: (sessionID: string) => void;
    resumeTaskLoop: (sessionID: string) => void;
    cleanupTaskLoop: (sessionID: string) => void;
    handleEvent: (event: LoopEvent) => Promise<void>;
    loops: {
        task: import("./task-loop.js").TaskLoop;
        iteration: import("./iteration-loop.js").IterationLoop;
    };
};
export declare function example1_AutoTaskContinuation(ctx: PluginContext): {
    startIterationLoop: (sessionID: string, task: string, options?: {
        maxIterations?: number;
    }) => Promise<boolean>;
    cancelIterationLoop: (sessionID: string) => boolean;
    getIterationLoopState: () => import("./types.js").IterationLoopState | null;
    pauseTaskLoop: (sessionID: string) => void;
    resumeTaskLoop: (sessionID: string) => void;
    cleanupTaskLoop: (sessionID: string) => void;
    handleEvent: (event: LoopEvent) => Promise<void>;
    loops: {
        task: import("./task-loop.js").TaskLoop;
        iteration: import("./iteration-loop.js").IterationLoop;
    };
};
export declare function example2_ManualIterationLoop(ctx: PluginContext): {
    startIterationLoop: (sessionID: string, task: string, options?: {
        maxIterations?: number;
    }) => Promise<boolean>;
    cancelIterationLoop: (sessionID: string) => boolean;
    getIterationLoopState: () => import("./types.js").IterationLoopState | null;
    pauseTaskLoop: (sessionID: string) => void;
    resumeTaskLoop: (sessionID: string) => void;
    cleanupTaskLoop: (sessionID: string) => void;
    handleEvent: (event: LoopEvent) => Promise<void>;
    loops: {
        task: import("./task-loop.js").TaskLoop;
        iteration: import("./iteration-loop.js").IterationLoop;
    };
};
export declare function example3_CombinedLoops(ctx: PluginContext): {
    startIterationLoop: (sessionID: string, task: string, options?: {
        maxIterations?: number;
    }) => Promise<boolean>;
    cancelIterationLoop: (sessionID: string) => boolean;
    getIterationLoopState: () => import("./types.js").IterationLoopState | null;
    pauseTaskLoop: (sessionID: string) => void;
    resumeTaskLoop: (sessionID: string) => void;
    cleanupTaskLoop: (sessionID: string) => void;
    handleEvent: (event: LoopEvent) => Promise<void>;
    loops: {
        task: import("./task-loop.js").TaskLoop;
        iteration: import("./iteration-loop.js").IterationLoop;
    };
};
export declare function example4_ErrorRecovery(ctx: PluginContext): {
    plugin: {
        startIterationLoop: (sessionID: string, task: string, options?: {
            maxIterations?: number;
        }) => Promise<boolean>;
        cancelIterationLoop: (sessionID: string) => boolean;
        getIterationLoopState: () => import("./types.js").IterationLoopState | null;
        pauseTaskLoop: (sessionID: string) => void;
        resumeTaskLoop: (sessionID: string) => void;
        cleanupTaskLoop: (sessionID: string) => void;
        handleEvent: (event: LoopEvent) => Promise<void>;
        loops: {
            task: import("./task-loop.js").TaskLoop;
            iteration: import("./iteration-loop.js").IterationLoop;
        };
    };
    handleError: (event: LoopEvent) => Promise<void>;
};
export declare function example5_MonitoringProgress(ctx: PluginContext): {
    startIterationLoop: (sessionID: string, task: string, options?: {
        maxIterations?: number;
    }) => Promise<boolean>;
    cancelIterationLoop: (sessionID: string) => boolean;
    getIterationLoopState: () => import("./types.js").IterationLoopState | null;
    pauseTaskLoop: (sessionID: string) => void;
    resumeTaskLoop: (sessionID: string) => void;
    cleanupTaskLoop: (sessionID: string) => void;
    handleEvent: (event: LoopEvent) => Promise<void>;
    loops: {
        task: import("./task-loop.js").TaskLoop;
        iteration: import("./iteration-loop.js").IterationLoop;
    };
};
export declare function example6_CustomCompletion(ctx: PluginContext): {
    startIterationLoop: (sessionID: string, task: string, options?: {
        maxIterations?: number;
    }) => Promise<boolean>;
    cancelIterationLoop: (sessionID: string) => boolean;
    getIterationLoopState: () => import("./types.js").IterationLoopState | null;
    pauseTaskLoop: (sessionID: string) => void;
    resumeTaskLoop: (sessionID: string) => void;
    cleanupTaskLoop: (sessionID: string) => void;
    handleEvent: (event: LoopEvent) => Promise<void>;
    loops: {
        task: import("./task-loop.js").TaskLoop;
        iteration: import("./iteration-loop.js").IterationLoop;
    };
};
export declare function example7_GracefulShutdown(ctx: PluginContext): {
    plugin: {
        startIterationLoop: (sessionID: string, task: string, options?: {
            maxIterations?: number;
        }) => Promise<boolean>;
        cancelIterationLoop: (sessionID: string) => boolean;
        getIterationLoopState: () => import("./types.js").IterationLoopState | null;
        pauseTaskLoop: (sessionID: string) => void;
        resumeTaskLoop: (sessionID: string) => void;
        cleanupTaskLoop: (sessionID: string) => void;
        handleEvent: (event: LoopEvent) => Promise<void>;
        loops: {
            task: import("./task-loop.js").TaskLoop;
            iteration: import("./iteration-loop.js").IterationLoop;
        };
    };
    cleanup: (sessionID: string) => void;
};
export declare function example8_PromptTagTrigger(ctx: PluginContext): {
    plugin: {
        startIterationLoop: (sessionID: string, task: string, options?: {
            maxIterations?: number;
        }) => Promise<boolean>;
        cancelIterationLoop: (sessionID: string) => boolean;
        getIterationLoopState: () => import("./types.js").IterationLoopState | null;
        pauseTaskLoop: (sessionID: string) => void;
        resumeTaskLoop: (sessionID: string) => void;
        cleanupTaskLoop: (sessionID: string) => void;
        handleEvent: (event: LoopEvent) => Promise<void>;
        loops: {
            task: import("./task-loop.js").TaskLoop;
            iteration: import("./iteration-loop.js").IterationLoop;
        };
    };
    handleUserPrompt: (sessionID: string, userPrompt: string) => Promise<import("./iteration-loop.js").ProcessPromptResult>;
};
export declare function example9_FullPluginWithPromptTags(ctx: PluginContext & {
    on: (event: string, handler: (arg: {
        sessionID: string;
        prompt: string;
        setPrompt: (newPrompt: string) => void;
    }) => void) => void;
}): {
    startIterationLoop: (sessionID: string, task: string, options?: {
        maxIterations?: number;
    }) => Promise<boolean>;
    cancelIterationLoop: (sessionID: string) => boolean;
    getIterationLoopState: () => import("./types.js").IterationLoopState | null;
    pauseTaskLoop: (sessionID: string) => void;
    resumeTaskLoop: (sessionID: string) => void;
    cleanupTaskLoop: (sessionID: string) => void;
    handleEvent: (event: LoopEvent) => Promise<void>;
    loops: {
        task: import("./task-loop.js").TaskLoop;
        iteration: import("./iteration-loop.js").IterationLoop;
    };
};
//# sourceMappingURL=example.d.ts.map