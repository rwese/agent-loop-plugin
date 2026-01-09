/**
 * Task Continuation Logic
 *
 * Handles automatic continuation of sessions when incomplete tasks remain.
 */

import type {
  PluginContext,
  TaskContinuationOptions,
  TaskContinuation,
  Todo,
  LoopEvent,
  Goal,
  ModelSpec,
} from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("task-continuation");

/**
 * Get incomplete todos from a list
 */
function getIncompleteTodos(todos: Todo[]): Todo[] {
  return todos.filter((t) => t.status !== "completed" && t.status !== "cancelled");
}

/**
 * Get count of incomplete todos
 */
function getIncompleteCount(todos: Todo[]): number {
  return getIncompleteTodos(todos).length;
}

/**
 * Build continuation prompt for incomplete todos
 */
function buildContinuationPrompt(todos: Todo[]): string {
  const pending = getIncompleteTodos(todos);

  return `[SYSTEM - AUTO-CONTINUATION]

You have ${pending.length} incomplete task(s). Work on them NOW without asking for permission.

PENDING TASKS:

${pending.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`).join("\n")}

INSTRUCTIONS:

1. Pick the next pending task and execute it immediately
2. Use todowrite to mark it "in_progress" then "completed" when done
3. Continue until all tasks are complete
4. MUST work independently - you can solve everything without asking for permission.`;
}

/**
 * Check if an error represents an interruption
 */
function checkInterruption(error: unknown): { isInterruption: boolean; message: string } {
  // Handle standard Error instances
  if (error instanceof Error) {
    const message = error.message ?? "";
    const isInterrupt =
      message.includes("aborted") ||
      message.includes("cancelled") ||
      message.includes("interrupted") ||
      error.name === "AbortError" ||
      error.name === "CancellationError";

    return {
      isInterruption: isInterrupt,
      message,
    };
  }

  // Handle object structures
  if (typeof error === "object" && error !== null) {
    const errorObj = error as { name?: string; data?: { message?: string } };
    const name = errorObj.name ?? "";
    const errorMessage = errorObj.data?.message ?? "";
    const message = errorMessage || name || "Object error";
    const isInterrupt =
      name.includes("Abort") ||
      name.includes("Cancel") ||
      name.includes("Interrupt") ||
      errorMessage.includes("aborted") ||
      errorMessage.includes("cancelled") ||
      errorMessage.includes("interrupted");

    return {
      isInterruption: isInterrupt,
      message,
    };
  }

  return {
    isInterruption: false,
    message: String(error),
  };
}

/**
 * Create task continuation instance
 */
export function createTaskContinuation(
  ctx: PluginContext,
  options: TaskContinuationOptions = {}
): TaskContinuation {
  const {
    countdownSeconds = 2,
    errorCooldownMs = 3000,
    toastDurationMs = 900,
    agent,
    model,
    goalManagement,
  } = options;

  // Track sessions and state
  const recoveringSessions = new Set<string>();
  const errorCooldowns = new Map<string, number>();
  const pendingCountdowns = new Map<string, ReturnType<typeof setTimeout>>();
  const lastProcessedMessageID = new Map<string, string>();
  const sessionAgentModel = new Map<string, { agent?: string; model?: string | ModelSpec }>();

  async function fetchTodos(sessionID: string): Promise<Todo[]> {
    try {
      const response = await ctx.client.session.todo({ path: { id: sessionID } });
      const todos = Array.isArray(response) ? response : (response.data ?? []);
      // Ensure todos match our Todo interface
      return todos.map(todo => ({
        id: todo.id,
        content: todo.content,
        status: todo.status as "pending" | "in_progress" | "completed" | "cancelled",
        priority: todo.priority
      }));
    } catch {
      return [];
    }
  }

  async function fetchSessionInfo(
    sessionID: string
  ): Promise<{ agent?: string; model?: string | { providerID: string; modelID: string } } | null> {
    try {
      if (typeof ctx.client.session.get === "function") {
        const sessionInfo = await ctx.client.session.get({ path: { id: sessionID } });
        
        // Handle the response structure - extract from data property if present
        const sessionData = (sessionInfo as { data?: { agent?: string; model?: string | { providerID: string; modelID: string } } }).data;
        const sessionObj = sessionInfo as { agent?: string; model?: string | { providerID: string; modelID: string } };
        const agent = sessionData?.agent || sessionObj.agent;
        const model = sessionData?.model || sessionObj.model;

        if (agent || model) {
          return { agent, model };
        }
      }
    } catch {
      log.debug("Exception calling session.get", { sessionID });
    }
    return null;
  }

  async function fetchAgentModelFromMessages(
    sessionID: string
  ): Promise<{ agent?: string; model?: string | ModelSpec } | null> {
    try {
      if (typeof ctx.client.session.messages !== "function") {
        return null;
      }

      const messagesResponse = await ctx.client.session.messages({ path: { id: sessionID } });

      if (Array.isArray(messagesResponse)) {
        for (const msg of messagesResponse) {
          const msgInfo = (
            msg as { info?: { agent?: string; model?: string | ModelSpec; role?: string } }
          ).info;

          if (msgInfo?.agent || msgInfo?.model) {
            return {
              agent: msgInfo.agent,
              model: msgInfo.model,
            };
          }
        }
      }
    } catch {
      log.debug("Error fetching messages for agent/model", { sessionID });
    }
    return null;
  }

  function updateSessionAgentModel(
    sessionID: string,
    eventAgent?: string,
    eventModel?: string | { providerID: string; modelID: string }
  ): void {
    if (eventAgent || eventModel) {
      sessionAgentModel.set(sessionID, {
        agent: eventAgent,
        model: eventModel,
      });
    }
  }

  async function getAgentModel(sessionID: string): Promise<{
    agent?: string | undefined;
    model?: string | { providerID: string; modelID: string } | undefined;
  }> {
    const tracked = sessionAgentModel.get(sessionID);
    if (tracked && (tracked.agent || tracked.model)) {
      return tracked;
    }

    const sessionInfo = await fetchSessionInfo(sessionID);
    if (sessionInfo && (sessionInfo.agent || sessionInfo.model)) {
      return sessionInfo;
    }

    const messagesInfo = await fetchAgentModelFromMessages(sessionID);
    if (messagesInfo && (messagesInfo.agent || messagesInfo.model)) {
      return messagesInfo;
    }

    return { agent: agent ?? undefined, model: model ?? undefined };
  }

  async function injectContinuation(sessionID: string): Promise<void> {
    log.debug("injectContinuation called", { sessionID });

    // Clear any pending countdown
    const existingTimeout = pendingCountdowns.get(sessionID);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      pendingCountdowns.delete(sessionID);
    }

    const todos = await fetchTodos(sessionID);
    const incompleteCount = getIncompleteCount(todos);

    log.debug("Checking todos for continuation", {
      sessionID,
      totalTodos: todos.length,
      incompleteCount,
    });

    // Check for active goals
    let activeGoal: Goal | null = null;
    let hasActiveGoal = false;
    if (goalManagement) {
      activeGoal = await goalManagement.getGoal(sessionID);
      hasActiveGoal = activeGoal !== null && activeGoal.status === "active";
      log.debug("Checking goals for continuation", {
        sessionID,
        hasGoal: activeGoal !== null,
        goalStatus: activeGoal?.status,
        goalTitle: activeGoal?.title,
      });
    }

    // Continue if there are incomplete todos OR active goals
    if (incompleteCount === 0 && !hasActiveGoal) {
      log.debug("No incomplete tasks or active goals, skipping continuation", { sessionID });
      return;
    }

    // Build combined continuation prompt
    let prompt = "";

    if (incompleteCount > 0) {
      prompt += buildContinuationPrompt(todos);
    }

    if (hasActiveGoal && activeGoal) {
      if (prompt.length > 0) {
        prompt += "\n\n";
      }
      prompt += `[SYSTEM - GOAL CONTINUATION]

CURRENT GOAL: ${activeGoal.title}
${activeGoal.description ? `DESCRIPTION: ${activeGoal.description}\n` : ""}
DONE CONDITION: ${activeGoal.done_condition}

INSTRUCTIONS:

1. Focus on completing the active goal above
2. Use goal_done when the goal's done condition is met
3. Work independently - you can solve everything without asking for permission.`;
    }

    // Get agent/model with polling
    let agentModel: {
      agent?: string | undefined;
      model?: string | { providerID: string; modelID: string } | undefined;
    } | null = null;
    let attempts = 0;
    const maxAttempts = 10;

    while (!agentModel || (!agentModel.agent && !agentModel.model && attempts < maxAttempts)) {
      if (attempts > 0) {
        const delay = attempts > 5 ? 50 : 10;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      agentModel = await getAgentModel(sessionID);

      if (agentModel && (agentModel.agent || agentModel.model)) {
        break;
      }

      attempts++;
      log.debug("Polling for agent/model", {
        sessionID,
        attempt: attempts,
        maxAttempts,
        hasAgent: !!agentModel?.agent,
        hasModel: !!agentModel?.model,
      });
    }

    const continuationAgent = agentModel?.agent;
    const continuationModel = agentModel?.model as { providerID: string; modelID: string } | undefined;

    log.debug("Injecting continuation prompt", {
      sessionID,
      agent: continuationAgent,
      model: continuationModel,
      promptLength: prompt.length,
    });

    try {
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: continuationAgent,
          model: continuationModel,
          parts: [{ type: "text", text: prompt }],
        },
        query: { directory: ctx.directory },
      });

      log.debug("Continuation prompt injected successfully", { sessionID });
    } catch (error) {
      log.error(`Failed to inject continuation for session ${sessionID}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function scheduleContinuation(sessionID: string): Promise<void> {
    // Clear any existing countdown
    const existingTimeout = pendingCountdowns.get(sessionID);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Schedule new countdown
    const timeout = setTimeout(async () => {
      pendingCountdowns.delete(sessionID);
      try {
        log.debug("Countdown timer fired, injecting continuation", { sessionID });
        await injectContinuation(sessionID);
      } catch (error) {
        log.error(`Error in continuation timeout callback for session ${sessionID}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, countdownSeconds * 1000);

    pendingCountdowns.set(sessionID, timeout);
    log.debug("Countdown timer scheduled", { sessionID, countdownSeconds });

    // Show toast notification
    try {
      await ctx.client.tui.showToast({
        body: {
          title: "Auto-Continuing",
          message: `Continuing in ${countdownSeconds} seconds...`,
          variant: "info",
          duration: toastDurationMs,
        },
      });
    } catch {
      // Ignore toast errors
    }
  }

  const handleSessionIdle = async (sessionID: string): Promise<void> => {
    // Check if session is recovering
    if (recoveringSessions.has(sessionID)) {
      return;
    }

    // Check error cooldown
    const lastError = errorCooldowns.get(sessionID) ?? 0;
    if (Date.now() - lastError < errorCooldownMs) {
      return;
    }

    const todos = await fetchTodos(sessionID);
    const incompleteCount = getIncompleteCount(todos);

    log.debug("Session idle - checking todos", {
      sessionID,
      totalTodos: todos.length,
      incompleteCount,
    });

    // Check for active goals
    let hasActiveGoal = false;
    if (goalManagement) {
      const goal = await goalManagement.getGoal(sessionID);
      hasActiveGoal = goal !== null && goal.status === "active";
      log.debug("Session idle - checking goals", {
        sessionID,
        hasGoal: goal !== null,
        goalStatus: goal?.status,
        goalTitle: goal?.title,
      });
    }

    // Continue if there are incomplete todos OR active goals
    if (incompleteCount === 0 && !hasActiveGoal) {
      return;
    }

    scheduleContinuation(sessionID);
  };

  const handleSessionError = async (sessionID: string, event?: LoopEvent): Promise<void> => {
    // Clear any pending countdown
    const existingTimeout = pendingCountdowns.get(sessionID);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      pendingCountdowns.delete(sessionID);
    }

    // Set error cooldown
    errorCooldowns.set(sessionID, Date.now());

    // Check for interruption
    const error = event?.properties?.error;
    const { isInterruption } = checkInterruption(error);

    if (isInterruption) {
      log.debug("Session interruption detected", { sessionID });

      try {
        await ctx.client.tui.showToast({
          body: {
            title: "Session Interrupted",
            message: "Task continuation paused due to interruption",
            variant: "warning",
            duration: 2000,
          },
        });
      } catch {
        // Ignore toast errors
      }
    }
  };

  const handleUserMessage = async (sessionID: string, event?: LoopEvent): Promise<void> => {
    log.debug("handleUserMessage called", { sessionID, eventType: event?.type });

    // Clear error cooldown on user message
    errorCooldowns.delete(sessionID);

    // Check for interruption in message
    const info = event?.properties?.info;
    const messageError = (info as { error?: unknown })?.error;
    if (messageError) {
      const { isInterruption } = checkInterruption(messageError);
      if (isInterruption) {
        const existingTimeout = pendingCountdowns.get(sessionID);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
          pendingCountdowns.delete(sessionID);
        }
        errorCooldowns.set(sessionID, Date.now());
        log.debug("Message interruption detected", { sessionID });
      }
    }

    // Check for new user message to cancel countdown
    const messageID = (info as { id?: string })?.id;
    const role = (info as { role?: string })?.role;
    const summary = (info as { summary?: unknown })?.summary;

    if (messageID) {
      const lastProcessed = lastProcessedMessageID.get(sessionID);
      if (lastProcessed !== messageID) {
        lastProcessedMessageID.set(sessionID, messageID);

        if (role === "user" && !summary) {
          const existingTimeout = pendingCountdowns.get(sessionID);
          if (existingTimeout) {
            clearTimeout(existingTimeout);
            pendingCountdowns.delete(sessionID);
            log.debug("New user message cancelled pending countdown", { sessionID, messageID });
          }
        }
      }
    }

    // Capture agent/model from user message
    if (event?.properties?.info) {
      const msgInfo = event.properties.info;
      const messageAgent = (msgInfo as { agent?: string }).agent;
      const messageModel = (msgInfo as { model?: string | ModelSpec }).model;

      if (messageAgent || messageModel) {
        log.debug("Captured agent/model from message", {
          sessionID,
          agent: messageAgent,
          model: messageModel,
        });
        updateSessionAgentModel(sessionID, messageAgent, messageModel);
      }
    }
  };

  const handleSessionDeleted = async (sessionID: string): Promise<void> => {
    // Cleanup session state
    recoveringSessions.delete(sessionID);
    errorCooldowns.delete(sessionID);
    sessionAgentModel.delete(sessionID);
    lastProcessedMessageID.delete(sessionID);

    const existingTimeout = pendingCountdowns.get(sessionID);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      pendingCountdowns.delete(sessionID);
    }
  };

  const handleSessionActive = async (sessionID: string): Promise<void> => {
    const existingTimeout = pendingCountdowns.get(sessionID);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      pendingCountdowns.delete(sessionID);
      log.debug("Session became active, cancelled pending countdown", { sessionID });
    }
  };

  const handleSessionBusy = async (sessionID: string): Promise<void> => {
    const existingTimeout = pendingCountdowns.get(sessionID);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      pendingCountdowns.delete(sessionID);
      log.debug("Session became busy, cancelled pending countdown", { sessionID });
    }
  };

  const handleSessionStatus = async (sessionID: string, event?: LoopEvent): Promise<void> => {
    const status = event?.properties?.status;
    if (
      status &&
      typeof status === "object" &&
      "type" in status &&
      (status as { type?: string }).type === "idle"
    ) {
      const lastError = errorCooldowns.get(sessionID) ?? 0;
      const recentError = Date.now() - lastError < 5000;

      if (recentError) {
        log.debug("Session returned to idle after recent error, skipping continuation", {
          sessionID,
          timeSinceError: Date.now() - lastError,
        });
        return;
      }
    }
  };

  function extractSessionID(event: LoopEvent): string | undefined {
    const props = event.properties;
    if (props?.sessionID && typeof props.sessionID === "string") return props.sessionID;
    if (props?.info?.sessionID && typeof props.info.sessionID === "string")
      return props.info.sessionID;
    if (props?.info?.id && typeof props.info.id === "string") return props.info.id;
    return undefined;
  }

  const handler = async ({ event }: { event: LoopEvent }): Promise<void> => {
    const sessionID = extractSessionID(event);
    if (!sessionID) return;

    switch (event.type) {
      case "session.idle":
        await handleSessionIdle(sessionID);
        break;
      case "session.error":
        await handleSessionError(sessionID, event);
        break;
      case "session.status":
        await handleSessionStatus(sessionID, event);
        break;
      case "message.updated":
        await handleUserMessage(sessionID, event);
        break;
      case "session.deleted":
        await handleSessionDeleted(sessionID);
        break;
      case "session.active":
        await handleSessionActive(sessionID);
        break;
      case "session.busy":
        await handleSessionBusy(sessionID);
        break;
    }
  };

  const markRecovering = (sessionID: string): void => {
    recoveringSessions.add(sessionID);
  };

  const markRecoveryComplete = (sessionID: string): void => {
    recoveringSessions.delete(sessionID);
  };

  const cancel = (sessionID: string): void => {
    const existingTimeout = pendingCountdowns.get(sessionID);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      pendingCountdowns.delete(sessionID);
    }

    errorCooldowns.delete(sessionID);
    recoveringSessions.delete(sessionID);
  };

  const cleanup = async (): Promise<void> => {
    for (const timeout of pendingCountdowns.values()) {
      clearTimeout(timeout);
    }
    pendingCountdowns.clear();
    recoveringSessions.clear();
    errorCooldowns.clear();
    sessionAgentModel.clear();
    lastProcessedMessageID.clear();
    log.debug("Task continuation cleanup completed");
  };

  return {
    handler,
    markRecovering,
    markRecoveryComplete,
    cancel,
    cleanup,
  };
}