const TAG_PATTERN = /<iterationLoop(?:\s+([^>]*))?>(\s*[\s\S]*?)<\/iterationLoop>/i;
const SELF_CLOSING_PATTERN = /<iterationLoop\s+([\s\S]*?)\s*\/>/i;
const getAttr = (attrs, name, isNumber = false) => {
    if (!attrs)
        return undefined;
    const pattern = isNumber
        ? new RegExp(`${name}\\s*=\\s*["']?(\\d+)["']?`)
        : new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`);
    const match = attrs.match(pattern);
    return match ? (isNumber ? parseInt(match[1], 10) : match[1]) : undefined;
};
export function parseIterationLoopTag(prompt) {
    let match = prompt.match(TAG_PATTERN);
    let task;
    let attributes;
    let matchedPattern = null;
    if (match) {
        matchedPattern = TAG_PATTERN;
        attributes = match[1]?.trim();
        task = match[2]?.trim();
    }
    else {
        match = prompt.match(SELF_CLOSING_PATTERN);
        if (match) {
            matchedPattern = SELF_CLOSING_PATTERN;
            attributes = match[1]?.trim();
            task = getAttr(attributes, "task");
        }
    }
    if (!match || !matchedPattern) {
        return { found: false, cleanedPrompt: prompt };
    }
    return {
        found: true,
        task,
        maxIterations: getAttr(attributes, "max", true),
        marker: getAttr(attributes, "marker"),
        cleanedPrompt: prompt
            .replace(matchedPattern, "")
            .replace(/\n{3,}/g, "\n\n")
            .trim(),
    };
}
export function buildIterationStartPrompt(task, maxIterations, _marker, userPrompt) {
    const parts = [
        `[ITERATION LOOP STARTED - 1/${maxIterations}]`,
        "",
        `Task: ${task}`,
        "",
        "Begin working on this task now.",
    ];
    if (userPrompt && userPrompt.trim()) {
        parts.push("", "---", "", userPrompt.trim());
    }
    return parts.join("\n");
}
//# sourceMappingURL=prompt-parser.js.map