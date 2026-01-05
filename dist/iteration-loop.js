import { createLogger, readLoopState, writeLoopState, clearLoopState, incrementIteration, sendIgnoredMessage, generateCodename, } from "./utils.js";
import { parseIterationLoopTag, buildIterationStartPrompt } from "./prompt-parser.js";
const DEFAULT_MAX_ITERATIONS = 100;
const ITERATION_DEBOUNCE_MS = 3000;
const CONTINUATION_PROMPT = `[ITERATION LOOP - ITERATION {{ITERATION}}/{{MAX}}]

You have completed {{ITERATION_MINUS_ONE}} iteration(s).

{{ADVISOR_FEEDBACK}}

Please address the issues above and continue working on the task.

{{PROMPT}}`;
export function createIterationLoop(ctx, options = {}) {
    const { defaultMaxIterations = DEFAULT_MAX_ITERATIONS, stateFilePath, logger: customLogger, logLevel = "info", agent, model, onEvaluator, getTranscript, } = options;
    const logger = createLogger(customLogger, logLevel);
    let activeSessionID = null;
    let currentIteration = 0;
    let maxIterations = defaultMaxIterations;
    let currentPrompt = "";
    let lastIterationTime = 0;
    const existingState = readLoopState(ctx.directory, stateFilePath);
    if (existingState?.active) {
        activeSessionID = existingState.session_id || null;
        currentIteration = existingState.iteration;
        maxIterations = existingState.max_iterations;
        currentPrompt = existingState.prompt;
        logger.info("Restored iteration loop state", {
            sessionID: activeSessionID,
            iteration: currentIteration,
            maxIterations,
        });
    }
    const showToast = (title, message, variant) => ctx.client.tui.showToast({ body: { title, message, variant, duration: 5000 } }).catch(() => { });
    const sendStatus = (sessionID, message) => sendIgnoredMessage(ctx.client, sessionID, message, logger, { agent, model });
    async function sendContinuationPrompt(sessionID, feedback) {
        const prompt = CONTINUATION_PROMPT.replace("{{ITERATION}}", String(currentIteration + 1))
            .replace("{{MAX}}", String(maxIterations))
            .replace("{{ITERATION_MINUS_ONE}}", String(currentIteration))
            .replace("{{PROMPT}}", currentPrompt)
            .replace("{{ADVISOR_FEEDBACK}}", feedback || "Please continue working on the task.");
        await ctx.client.session.prompt({
            path: { id: sessionID },
            body: { agent, model, parts: [{ type: "text", text: prompt }] },
            query: { directory: ctx.directory },
        });
    }
    function resetState() {
        activeSessionID = null;
        currentIteration = 0;
        maxIterations = defaultMaxIterations;
        currentPrompt = "";
        clearLoopState(ctx.directory, stateFilePath);
    }
    const startLoop = async (sessionID, prompt, loopOptions) => {
        const max = loopOptions?.maxIterations ?? defaultMaxIterations;
        const codename = generateCodename();
        const state = {
            active: true,
            iteration: 1,
            max_iterations: max,
            completion_marker: codename,
            started_at: new Date().toISOString(),
            prompt,
            session_id: sessionID,
        };
        const success = writeLoopState(ctx.directory, state, stateFilePath);
        if (success) {
            activeSessionID = sessionID;
            currentIteration = 1;
            maxIterations = max;
            currentPrompt = prompt;
            await sendStatus(sessionID, `🔄 [startLoop] Iteration Loop: Started (1/${max}) - Advisor will evaluate completion`);
        }
        return success;
    };
    const cancelLoop = (sessionID) => {
        if (activeSessionID !== sessionID)
            return false;
        const iterations = currentIteration;
        resetState();
        showToast("Iteration Loop Cancelled", `Loop cancelled at iteration ${iterations}/${maxIterations}`, "warning");
        return true;
    };
    const completeLoop = (sessionID, summary) => {
        if (!activeSessionID) {
            return { success: false, iterations: 0, message: "No active iteration loop to complete" };
        }
        if (activeSessionID !== sessionID) {
            return { success: false, iterations: 0, message: "Session ID does not match active loop" };
        }
        const iterations = currentIteration;
        resetState();
        const summaryText = summary ? ` - ${summary}` : "";
        return {
            success: true,
            iterations,
            message: `Loop completed successfully after ${iterations} iteration(s)${summaryText}`,
        };
    };
    const getState = () => {
        return readLoopState(ctx.directory, stateFilePath);
    };
    const processPrompt = async (sessionID, prompt) => {
        const parsed = parseIterationLoopTag(prompt);
        if (!parsed.found || !parsed.task) {
            return { shouldIntercept: false, modifiedPrompt: prompt };
        }
        const max = parsed.maxIterations ?? defaultMaxIterations;
        await startLoop(sessionID, parsed.task, { maxIterations: max });
        const state = getState();
        const marker = state?.completion_marker ?? "UNKNOWN";
        const modifiedPrompt = buildIterationStartPrompt(parsed.task, max, marker, parsed.cleanedPrompt);
        return { shouldIntercept: true, modifiedPrompt };
    };
    const handleSessionIdle = async (sessionID) => {
        const now = Date.now();
        if (now - lastIterationTime < ITERATION_DEBOUNCE_MS) {
            logger.debug("Skipping: too soon since last action", { sessionID });
            return;
        }
        lastIterationTime = now;
        if (!onEvaluator) {
            logger.error("No onEvaluator callback provided", { sessionID });
            return;
        }
        let transcript = "";
        if (getTranscript) {
            try {
                transcript = await getTranscript(sessionID);
            }
            catch (err) {
                logger.warn("Failed to get transcript", { sessionID, error: String(err) });
            }
        }
        try {
            const evaluation = await onEvaluator({
                sessionID,
                iteration: currentIteration,
                maxIterations,
                prompt: currentPrompt,
                transcript,
                complete: (summary) => completeLoop(sessionID, summary),
                continueWithFeedback: async () => { },
            });
            if (evaluation.isComplete) {
                const result = completeLoop(sessionID, evaluation.feedback);
                await showToast("Iteration Loop Complete!", `Task completed after ${result.iterations} iteration(s): ${evaluation.feedback}`, "success");
                await sendStatus(sessionID, `🎉 Iteration Loop: Complete! Finished in ${result.iterations} iteration(s). Advisor: ${evaluation.feedback}`);
            }
            else if (currentIteration >= maxIterations) {
                resetState();
                await showToast("Iteration Loop Stopped", `Max iterations (${maxIterations}) reached without completion`, "warning");
                await sendStatus(sessionID, `⚠️ Iteration Loop: Stopped - Max iterations (${maxIterations}) reached`);
            }
            else {
                incrementIteration(ctx.directory, stateFilePath);
                currentIteration++;
                const truncatedFeedback = evaluation.feedback.length > 100
                    ? `${evaluation.feedback.substring(0, 100)}...`
                    : evaluation.feedback;
                await showToast("Iteration Loop", `Iteration ${currentIteration}/${maxIterations} - Advisor feedback provided`, "info");
                await sendStatus(sessionID, `🔄 Iteration Loop: Iteration ${currentIteration}/${maxIterations} - Advisor feedback: ${truncatedFeedback}`);
                await sendContinuationPrompt(sessionID, evaluation.feedback);
            }
        }
        catch (evalError) {
            logger.error("Advisor evaluation failed", { sessionID, error: String(evalError) });
            resetState();
            await showToast("Iteration Loop Error", `Error during evaluation: ${String(evalError)}`, "error");
        }
    };
    const handler = async ({ event }) => {
        const props = event.properties;
        const sessionID = props?.sessionID || props?.info?.sessionID;
        if (event.type === "session.deleted" && props?.info?.id === activeSessionID) {
            resetState();
            await showToast("Iteration Loop Cleared", "Loop cleared due to session deletion", "info");
            return;
        }
        if (!activeSessionID || sessionID !== activeSessionID)
            return;
        if (event.type === "session.error")
            return;
        if (event.type === "message.updated" && props?.info?.role === "assistant")
            return;
        if (event.type === "session.idle") {
            await handleSessionIdle(sessionID);
        }
    };
    return {
        handler,
        startLoop,
        cancelLoop,
        completeLoop,
        getState,
        processPrompt,
    };
}
//# sourceMappingURL=iteration-loop.js.map