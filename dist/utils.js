import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, appendFileSync, } from "node:fs";
import { dirname, join } from "node:path";
export function parseFrontmatter(content) {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);
    if (!match) {
        return { data: {}, body: content };
    }
    const yamlContent = match[1];
    const body = match[2];
    const data = {};
    for (const line of yamlContent.split("\n")) {
        const colonIndex = line.indexOf(":");
        if (colonIndex !== -1) {
            const key = line.slice(0, colonIndex).trim();
            let value = line.slice(colonIndex + 1).trim();
            if (typeof value === "string" && /^["'].*["']$/.test(value)) {
                value = value.slice(1, -1);
            }
            if (value === "true")
                value = true;
            else if (value === "false")
                value = false;
            else if (!isNaN(Number(value)) && value !== "")
                value = Number(value);
            data[key] = value;
        }
    }
    return { data: data, body };
}
export function isAbortError(error) {
    if (!error)
        return false;
    const isAbortMessage = (msg) => msg.includes("abort") || msg.includes("cancel") || msg.includes("interrupt");
    if (typeof error === "string") {
        return isAbortMessage(error.toLowerCase());
    }
    if (typeof error === "object") {
        const { name, message } = error;
        const lowerMessage = message?.toLowerCase() ?? "";
        if (name === "AbortError")
            return true;
        if (name === "MessageAbortedError" && lowerMessage && isAbortMessage(lowerMessage))
            return true;
        if (name === "DOMException" && lowerMessage.includes("abort"))
            return true;
        if (lowerMessage.includes("aborted") ||
            lowerMessage.includes("cancelled") ||
            lowerMessage.includes("interrupted"))
            return true;
    }
    return false;
}
const DEFAULT_STATE_FILE = ".agent-loop/iteration-state.md";
const DEFAULT_OUTPUT_FILE = ".agent-loop/output.log";
function getFilePath(directory, customPath, defaultPath) {
    return join(directory, customPath ?? defaultPath);
}
function safeUnlink(filePath) {
    try {
        if (existsSync(filePath))
            unlinkSync(filePath);
        return true;
    }
    catch {
        return false;
    }
}
function ensureDir(filePath) {
    const dir = dirname(filePath);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
}
const CODENAME_ADJECTIVES = [
    "SILENT",
    "CRIMSON",
    "SHADOW",
    "IRON",
    "GOLDEN",
    "ARCTIC",
    "PHANTOM",
    "STEEL",
    "MIDNIGHT",
    "COBALT",
    "VELVET",
    "THUNDER",
    "SILVER",
    "OBSIDIAN",
    "SCARLET",
    "AZURE",
    "ONYX",
    "AMBER",
    "JADE",
    "RAVEN",
    "FROST",
    "EMBER",
    "STORM",
    "LUNAR",
    "SOLAR",
    "NOBLE",
    "SWIFT",
    "BOLD",
    "DARK",
    "BRIGHT",
];
const CODENAME_NOUNS = [
    "THUNDER",
    "FALCON",
    "SERPENT",
    "PHOENIX",
    "DRAGON",
    "EAGLE",
    "WOLF",
    "TIGER",
    "VIPER",
    "HAWK",
    "LION",
    "PANTHER",
    "COBRA",
    "CONDOR",
    "JAGUAR",
    "SPHINX",
    "GRIFFIN",
    "HYDRA",
    "KRAKEN",
    "TITAN",
    "ORACLE",
    "SENTINEL",
    "GUARDIAN",
    "SPECTRE",
    "CIPHER",
    "VECTOR",
    "NEXUS",
    "APEX",
    "PRISM",
    "VERTEX",
];
export function generateCodename() {
    const adjective = CODENAME_ADJECTIVES[Math.floor(Math.random() * CODENAME_ADJECTIVES.length)];
    const noun = CODENAME_NOUNS[Math.floor(Math.random() * CODENAME_NOUNS.length)];
    return `${adjective}_${noun}`;
}
export function getStateFilePath(directory, customPath) {
    return getFilePath(directory, customPath, DEFAULT_STATE_FILE);
}
const stripQuotes = (val) => String(val ?? "").replace(/^["']|["']$/g, "");
export function readLoopState(directory, customPath) {
    const filePath = getStateFilePath(directory, customPath);
    if (!existsSync(filePath))
        return null;
    try {
        const content = readFileSync(filePath, "utf-8");
        const { data, body } = parseFrontmatter(content);
        if (data.active === undefined || data.iteration === undefined)
            return null;
        const iterationNum = typeof data.iteration === "number" ? data.iteration : parseInt(String(data.iteration), 10);
        if (isNaN(iterationNum))
            return null;
        return {
            active: data.active === true || data.active === "true",
            iteration: iterationNum,
            max_iterations: Number(data.max_iterations) || 100,
            completion_marker: stripQuotes(data.completion_marker) || "DONE",
            started_at: stripQuotes(data.started_at) || new Date().toISOString(),
            prompt: body.trim(),
            session_id: data.session_id ? stripQuotes(data.session_id) : undefined,
        };
    }
    catch {
        return null;
    }
}
export function writeLoopState(directory, state, customPath) {
    const filePath = getStateFilePath(directory, customPath);
    try {
        ensureDir(filePath);
        const sessionIdLine = state.session_id ? `session_id: "${state.session_id}"\n` : "";
        const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.max_iterations}
completion_marker: "${state.completion_marker}"
started_at: "${state.started_at}"
${sessionIdLine}---
${state.prompt}
`;
        writeFileSync(filePath, content, "utf-8");
        return true;
    }
    catch {
        return false;
    }
}
export function clearLoopState(directory, customPath) {
    return safeUnlink(getStateFilePath(directory, customPath));
}
export function incrementIteration(directory, customPath) {
    const state = readLoopState(directory, customPath);
    if (!state)
        return null;
    state.iteration += 1;
    if (writeLoopState(directory, state, customPath)) {
        return state;
    }
    return null;
}
const LOG_LEVELS = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
};
function formatLogMessage(level, message, data) {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` ${JSON.stringify(data)}` : "";
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`;
}
const shouldLog = (level, minLevel) => LOG_LEVELS[level] <= LOG_LEVELS[minLevel];
function buildLogger(handler, logLevel) {
    const createMethod = (level) => (message, data) => {
        if (shouldLog(level, logLevel))
            handler(level, message, data);
    };
    return {
        debug: createMethod("debug"),
        info: createMethod("info"),
        warn: createMethod("warn"),
        error: createMethod("error"),
    };
}
export function createLogger(customLogger, logLevel = "info") {
    return buildLogger((level, message, data) => {
        const formatted = formatLogMessage(level, message, data);
        (customLogger?.[level] ?? console[level])(formatted, data);
    }, logLevel);
}
export async function sendIgnoredMessage(client, sessionID, text, logger, options) {
    try {
        await client.session.prompt({
            path: { id: sessionID },
            body: {
                agent: options?.agent,
                model: options?.model,
                noReply: true,
                parts: [
                    {
                        type: "text",
                        text: text,
                        ignored: true,
                    },
                ],
            },
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (logger) {
            logger.error("Failed to send ignored message", {
                error: message,
                sessionID,
            });
        }
    }
}
export function getOutputFilePath(directory, customPath) {
    return getFilePath(directory, customPath, DEFAULT_OUTPUT_FILE);
}
export function writeOutput(directory, message, data, customPath) {
    const filePath = getOutputFilePath(directory, customPath);
    try {
        ensureDir(filePath);
        const timestamp = new Date().toISOString();
        const dataStr = data ? ` ${JSON.stringify(data)}` : "";
        appendFileSync(filePath, `[${timestamp}] ${message}${dataStr}\n`, "utf-8");
        return true;
    }
    catch {
        return false;
    }
}
export function clearOutput(directory, customPath) {
    return safeUnlink(getOutputFilePath(directory, customPath));
}
export function createFileLogger(directory, customPath, logLevel = "info") {
    return buildLogger((level, message, data) => {
        writeOutput(directory, `[${level.toUpperCase()}] ${message}`, data, customPath);
    }, logLevel);
}
//# sourceMappingURL=utils.js.map