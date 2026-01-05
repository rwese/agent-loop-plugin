import { isAbortError, createLogger, sendIgnoredMessage, writeOutput } from "./utils.js";
const getIncompleteTodos = (todos) => todos.filter((t) => t.status !== "completed" && t.status !== "cancelled");
const formatTaskList = (todos) => getIncompleteTodos(todos)
    .map((t, i) => `${i + 1}. [${t.status}] ${t.content}`)
    .join("\n");
const buildHelpSection = (helpAgent) => helpAgent
    ? `
IF YOU NEED HELP:
- Use the Task tool with subagent_type="${helpAgent}" to ask questions or get feedback
- Example: Task(prompt="I need clarification on...", subagent_type="${helpAgent}")
- Only use this if you are truly blocked - prefer making progress independently`
    : "";
function buildContinuationPrompt(todos, helpAgent) {
    const pending = getIncompleteTodos(todos);
    return `[SYSTEM - AUTO-CONTINUATION]

You have ${pending.length} incomplete task(s). Work on them NOW without asking for permission.

PENDING TASKS:

${formatTaskList(todos)}

INSTRUCTIONS:

1. Pick the next pending task and execute it immediately
2. Use todowrite to mark it "in_progress" then "completed" when done
3. Continue until all tasks are complete
4. MUST work independently - you can solve everything without asking for permission.
${buildHelpSection(helpAgent)}`;
}
const globalSessions = new Map();
let globalStateCounter = 0;
export function createTaskLoop(ctx, options = {}) {
    const { countdownSeconds = 2, errorCooldownMs = 3000, toastDurationMs = 900, logger: customLogger, logLevel = "info", agent, model, outputFilePath, helpAgent, onCountdownStart, } = options;
    const logger = createLogger(customLogger, logLevel);
    const isDebug = logLevel === "debug";
    const useExternalTimer = !!onCountdownStart;
    const sessions = globalSessions;
    function logToFile(message, data) {
        if (outputFilePath) {
            writeOutput(ctx.directory, message, data, outputFilePath);
        }
    }
    if (isDebug) {
        const loadedAt = new Date().toLocaleTimeString();
        ctx.client.tui
            .showToast({
            body: {
                title: "Task Loop",
                message: `Plugin loaded at ${loadedAt} (debug mode)`,
                variant: "info",
                duration: 2000,
            },
        })
            .catch(() => { });
    }
    function getState(sessionID) {
        let state = sessions.get(sessionID);
        if (!state) {
            globalStateCounter++;
            state = { _id: globalStateCounter };
            sessions.set(sessionID, state);
        }
        return state;
    }
    function cancelCountdown(sessionID, reason) {
        const state = sessions.get(sessionID);
        if (!state)
            return;
        const hadCountdown = !!(state.countdownTimer || state.countdownInterval);
        if (state.countdownTimer)
            clearTimeout(state.countdownTimer);
        if (state.countdownInterval)
            clearInterval(state.countdownInterval);
        state.countdownTimer = undefined;
        state.countdownInterval = undefined;
        state.countdownStarting = false;
        if (hadCountdown) {
            logger.debug("[cancelCountdown] Countdown cancelled", {
                sessionID,
                reason: reason ?? "unknown",
            });
        }
    }
    function cleanup(sessionID) {
        cancelCountdown(sessionID, "cleanup");
        sessions.delete(sessionID);
    }
    const markRecovering = (sessionID) => {
        const state = getState(sessionID);
        state.isRecovering = true;
        cancelCountdown(sessionID, "markRecovering");
        logger.debug("Skipping: session in recovery mode", { sessionID });
    };
    const markRecoveryComplete = (sessionID) => {
        const state = sessions.get(sessionID);
        if (!state)
            return;
        state.isRecovering = false;
        logger.debug("[markRecoveryComplete] Session recovery complete", { sessionID });
    };
    async function showCountdownToast(seconds, incompleteCount) {
        await ctx.client.tui
            .showToast({
            body: {
                title: "Task Continuation",
                message: `Resuming in ${seconds}s... (${incompleteCount} tasks remaining)`,
                variant: "warning",
                duration: toastDurationMs,
            },
        })
            .catch(() => { });
    }
    async function showStatusMessage(sessionID, message) {
        await sendIgnoredMessage(ctx.client, sessionID, message, logger, { agent, model });
    }
    const getIncompleteCount = (todos) => getIncompleteTodos(todos).length;
    async function fetchTodos(sessionID) {
        try {
            const response = await ctx.client.session.todo({ path: { id: sessionID } });
            return Array.isArray(response) ? response : (response.data ?? []);
        }
        catch (err) {
            logger.error("Failed to fetch todos", { sessionID, error: String(err) });
            return [];
        }
    }
    function isInCooldown(sessionID) {
        const state = sessions.get(sessionID);
        if (state?.isRecovering)
            return true;
        if (state?.lastErrorAt && Date.now() - state.lastErrorAt < errorCooldownMs)
            return true;
        return false;
    }
    async function injectContinuation(sessionID, _incompleteCount, total) {
        logger.debug("[injectContinuation] Called", { sessionID, _incompleteCount, total });
        if (isInCooldown(sessionID)) {
            logger.debug("[injectContinuation] Skipping: session in cooldown", { sessionID });
            return;
        }
        const todos = await fetchTodos(sessionID);
        const freshIncompleteCount = getIncompleteCount(todos);
        if (freshIncompleteCount === 0) {
            logger.debug("[injectContinuation] Skipping: no incomplete todos", { sessionID });
            return;
        }
        const prompt = buildContinuationPrompt(todos, helpAgent);
        const logData = { sessionID, incompleteCount: freshIncompleteCount, totalTasks: total };
        try {
            logger.debug(`Injecting continuation prompt (${freshIncompleteCount} tasks remaining)`, logData);
            logToFile(`Injecting continuation prompt (${freshIncompleteCount} tasks remaining)`, logData);
            await ctx.client.session.prompt({
                path: { id: sessionID },
                body: { agent, model, parts: [{ type: "text", text: prompt }] },
                query: { directory: ctx.directory },
            });
            logger.debug("Continuation prompt injected successfully", { sessionID });
            logToFile("Continuation prompt injected successfully", { sessionID });
        }
        catch (err) {
            const errorData = { sessionID, error: String(err) };
            logger.error("Failed to inject continuation prompt", errorData);
            logToFile("Failed to inject continuation prompt", errorData);
        }
    }
    function startCountdown(sessionID, incompleteCount, total) {
        const state = getState(sessionID);
        if (state.countdownTimer || state.countdownStarting) {
            logger.debug("[startCountdown] Countdown already active, skipping", { sessionID });
            return;
        }
        state.countdownStarting = true;
        logger.debug("[startCountdown] Starting countdown for task continuation...", {
            sessionID,
            seconds: countdownSeconds,
            incompleteCount,
            useExternalTimer,
        });
        if (useExternalTimer && onCountdownStart) {
            logger.debug("[startCountdown] Using external timer callback", { sessionID });
            state.countdownTimer = setTimeout(() => { }, 0);
            onCountdownStart({
                sessionID,
                incompleteCount,
                totalCount: total,
                inject: async () => {
                    logger.debug("[startCountdown] External timer triggered injection", { sessionID });
                    cancelCountdown(sessionID, "external-timer-complete");
                    await injectContinuation(sessionID, incompleteCount, total);
                },
            });
            return;
        }
        let secondsRemaining = countdownSeconds;
        showCountdownToast(secondsRemaining, incompleteCount);
        state.countdownInterval = setInterval(() => {
            secondsRemaining--;
            if (secondsRemaining > 0) {
                showCountdownToast(secondsRemaining, incompleteCount);
            }
        }, 1000);
        const timer = setTimeout(async () => {
            logger.debug("[startCountdown] Countdown finished, injecting continuation", {
                sessionID,
                incompleteCount,
                total,
            });
            cancelCountdown(sessionID, "countdown-complete");
            try {
                await injectContinuation(sessionID, incompleteCount, total);
            }
            catch (err) {
                logger.error("[startCountdown] Failed to inject continuation", {
                    sessionID,
                    error: String(err),
                });
            }
        }, countdownSeconds * 1000);
        if (timer.ref) {
            timer.ref();
        }
        state.countdownTimer = timer;
        logger.debug("[startCountdown] Timer set", {
            sessionID,
            countdownSeconds,
            timerSet: !!state.countdownTimer,
        });
    }
    const handleSessionError = (sessionID, error) => {
        const state = getState(sessionID);
        state.lastErrorAt = Date.now();
        cancelCountdown(sessionID, "session-error");
        logger.debug("[session.error] Session error detected", {
            sessionID,
            isAbort: isAbortError(error),
        });
    };
    const handleSessionIdle = async (sessionID) => {
        logger.debug("[session.idle] Session idle detected", { sessionID });
        if (isInCooldown(sessionID)) {
            logger.debug("[session.idle] Skipping: session in cooldown", { sessionID });
            return;
        }
        const todos = await fetchTodos(sessionID);
        if (todos.length === 0) {
            logger.debug("[session.idle] No todos found", { sessionID });
            return;
        }
        const state = getState(sessionID);
        const incompleteCount = getIncompleteCount(todos);
        if (incompleteCount === 0) {
            if (!state.completionShown) {
                state.completionShown = true;
                await showStatusMessage(sessionID, `✅ Task Loop: All ${todos.length} tasks completed!`);
            }
            return;
        }
        state.completionShown = false;
        startCountdown(sessionID, incompleteCount, todos.length);
    };
    const handleUserMessage = (sessionID) => {
        const state = sessions.get(sessionID);
        if (state) {
            state.lastErrorAt = undefined;
            if (state.countdownTimer)
                cancelCountdown(sessionID, "user-message");
        }
    };
    const handler = async ({ event }) => {
        const props = event.properties;
        switch (event.type) {
            case "session.error":
                if (props?.sessionID)
                    handleSessionError(props.sessionID, props?.error);
                break;
            case "session.idle":
                if (props?.sessionID)
                    await handleSessionIdle(props.sessionID);
                break;
            case "message.updated":
                if (props?.info?.sessionID && props?.info?.role === "user") {
                    handleUserMessage(props.info.sessionID);
                }
                break;
            case "session.deleted":
                if (props?.info?.id) {
                    cleanup(props.info.id);
                    logger.debug("[session.deleted] Session deleted: cleaned up", {
                        sessionID: props.info.id,
                    });
                }
                break;
        }
    };
    return {
        handler,
        markRecovering,
        markRecoveryComplete,
        cleanup,
    };
}
//# sourceMappingURL=task-loop.js.map