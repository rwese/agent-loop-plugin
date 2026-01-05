import { createTaskLoop, createIterationLoop, sendIgnoredMessage } from "./index.js";
export default function examplePlugin(ctx) {
    const taskLoop = createTaskLoop(ctx, {
        countdownSeconds: 3,
        errorCooldownMs: 5000,
        toastDurationMs: 1000,
    });
    const iterationLoop = createIterationLoop(ctx, {
        defaultMaxIterations: 50,
    });
    const handleEvent = async (event) => {
        await Promise.all([taskLoop.handler({ event }), iterationLoop.handler({ event })]);
    };
    return {
        startIterationLoop: (sessionID, task, options) => {
            return iterationLoop.startLoop(sessionID, task, options);
        },
        cancelIterationLoop: (sessionID) => {
            return iterationLoop.cancelLoop(sessionID);
        },
        getIterationLoopState: () => {
            return iterationLoop.getState();
        },
        pauseTaskLoop: (sessionID) => {
            taskLoop.markRecovering(sessionID);
        },
        resumeTaskLoop: (sessionID) => {
            taskLoop.markRecoveryComplete(sessionID);
        },
        cleanupTaskLoop: (sessionID) => {
            taskLoop.cleanup(sessionID);
        },
        handleEvent,
        loops: {
            task: taskLoop,
            iteration: iterationLoop,
        },
    };
}
export function example1_AutoTaskContinuation(ctx) {
    const plugin = examplePlugin(ctx);
    return plugin;
}
export function example2_ManualIterationLoop(ctx) {
    const plugin = examplePlugin(ctx);
    plugin.startIterationLoop("session-123", `Create a complete REST API with:
    - User authentication (JWT)
    - CRUD endpoints for users
    - Database integration (PostgreSQL)
    - API documentation
    - Unit tests
    
    When complete, use the iteration_loop_complete tool.`, {
        maxIterations: 30,
    });
    return plugin;
}
export function example3_CombinedLoops(ctx) {
    const plugin = examplePlugin(ctx);
    plugin.startIterationLoop("session-456", `Implement feature X with full test coverage.
    
    When complete, use the iteration_loop_complete tool.`, {
        maxIterations: 15,
    });
    return plugin;
}
export function example4_ErrorRecovery(ctx) {
    const plugin = examplePlugin(ctx);
    const handleError = async (event) => {
        const sessionID = event.properties?.sessionID;
        if (!sessionID)
            return;
        await sendIgnoredMessage(ctx.client, sessionID, "⚠️ [Error Handler] Session error detected - pausing task loop for recovery");
        plugin.pauseTaskLoop(sessionID);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        plugin.resumeTaskLoop(sessionID);
    };
    return { plugin, handleError };
}
export function example5_MonitoringProgress(ctx) {
    const plugin = examplePlugin(ctx);
    plugin.startIterationLoop("session-789", "Complex task", {
        maxIterations: 20,
    });
    setInterval(() => {
        const state = plugin.getIterationLoopState();
        if (state) {
            if (state.iteration / state.max_iterations > 0.9) {
            }
        }
    }, 5000);
    return plugin;
}
export function example6_CustomCompletion(ctx) {
    const plugin = examplePlugin(ctx);
    plugin.startIterationLoop("session-999", `Deploy the application to production.
    
    Checklist:
    - [ ] Tests passing
    - [ ] Docker image built
    - [ ] Deployed to staging
    - [ ] Smoke tests passed
    - [ ] Deployed to production
    
    When ALL steps complete, use the iteration_loop_complete tool.`, {
        maxIterations: 10,
    });
    return plugin;
}
export function example7_GracefulShutdown(ctx) {
    const plugin = examplePlugin(ctx);
    const cleanup = (sessionID) => {
        plugin.cleanupTaskLoop(sessionID);
        plugin.cancelIterationLoop(sessionID);
    };
    return { plugin, cleanup };
}
export function example8_PromptTagTrigger(ctx) {
    const plugin = examplePlugin(ctx);
    const handleUserPrompt = async (sessionID, userPrompt) => {
        const result = await plugin.loops.iteration.processPrompt(sessionID, userPrompt);
        if (result.shouldIntercept) {
            await sendIgnoredMessage(ctx.client, sessionID, `🚀 [Iteration Loop] Loop started - Modified prompt:\n${result.modifiedPrompt}`);
        }
        else {
            await sendIgnoredMessage(ctx.client, sessionID, "ℹ️ [Iteration Loop] No iteration tag found - sending original prompt to AI");
        }
        return result;
    };
    return { plugin, handleUserPrompt };
}
export function example9_FullPluginWithPromptTags(ctx) {
    const plugin = examplePlugin(ctx);
    ctx.on("event", plugin.handleEvent);
    ctx.on("prompt.before", async (event) => {
        const result = await plugin.loops.iteration.processPrompt(event.sessionID, event.prompt);
        if (result.shouldIntercept) {
            event.setPrompt(result.modifiedPrompt);
        }
    });
    return plugin;
}
//# sourceMappingURL=example.js.map