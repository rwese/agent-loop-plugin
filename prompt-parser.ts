/**
 * Prompt Parser - Parse iteration loop tags from user prompts
 *
 * Supports tag syntax:
 * - <iterationLoop>task</iterationLoop>
 * - <iterationLoop max="20">task</iterationLoop>
 * - <iterationLoop max="20" marker="DONE">task</iterationLoop>
 * - <iterationLoop task="..." max="20" marker="DONE" /> (self-closing)
 */

/**
 * Result of parsing an iteration loop tag from a prompt
 */
export interface IterationLoopTagResult {
  /** Whether an iteration loop tag was found */
  found: boolean
  /** The task extracted from the tag content */
  task?: string
  /** Maximum iterations (from max attribute) */
  maxIterations?: number
  /** Completion marker (from marker attribute) */
  marker?: string
  /** The prompt with the tag removed */
  cleanedPrompt: string
}

/**
 * Parse <iterationLoop> tag from user prompt
 *
 * The tag is removed from the prompt and its contents are extracted
 * for use in starting an iteration loop.
 *
 * @param prompt - The raw user prompt that may contain an iteration loop tag
 * @returns Parsed result with tag contents and cleaned prompt
 *
 * @example
 * ```typescript
 * const result = parseIterationLoopTag(`
 *   Please help:
 *   <iterationLoop max="10" marker="COMPLETE">
 *   Build a REST API
 *   </iterationLoop>
 * `);
 *
 * // result.found === true
 * // result.task === "Build a REST API"
 * // result.maxIterations === 10
 * // result.marker === "COMPLETE"
 * // result.cleanedPrompt === "Please help:"
 * ```
 *
 * @example Self-closing syntax
 * ```typescript
 * const result = parseIterationLoopTag(`
 *   <iterationLoop task="Build API" max="10" />
 * `);
 *
 * // result.found === true
 * // result.task === "Build API"
 * // result.maxIterations === 10
 * ```
 */
export function parseIterationLoopTag(prompt: string): IterationLoopTagResult {
  // Pattern for <iterationLoop ...>content</iterationLoop>
  // Using [\s\S]*? for non-greedy match across newlines
  const tagPattern = /<iterationLoop(?:\s+([^>]*))?>(\s*[\s\S]*?)<\/iterationLoop>/i

  // Pattern for self-closing <iterationLoop ... />
  const selfClosingPattern = /<iterationLoop\s+([\s\S]*?)\s*\/>/i

  let match = prompt.match(tagPattern)
  let task: string | undefined
  let attributes: string | undefined
  let matchedPattern: RegExp | null = null

  if (match) {
    matchedPattern = tagPattern
    attributes = match[1]?.trim()
    task = match[2]?.trim()
  } else {
    // Try self-closing syntax
    match = prompt.match(selfClosingPattern)
    if (match) {
      matchedPattern = selfClosingPattern
      attributes = match[1]?.trim()
      // For self-closing, task must be in attributes
      const taskMatch = attributes?.match(/task\s*=\s*["']([^"']+)["']/)
      task = taskMatch?.[1]
    }
  }

  if (!match || !matchedPattern) {
    return { found: false, cleanedPrompt: prompt }
  }

  // Parse attributes
  const maxMatch = attributes?.match(/max\s*=\s*["']?(\d+)["']?/)
  const markerMatch = attributes?.match(/marker\s*=\s*["']([^"']+)["']/)

  // Remove the tag from the prompt
  const cleanedPrompt = prompt
    .replace(matchedPattern, "")
    .replace(/\n{3,}/g, "\n\n") // Collapse multiple newlines
    .trim()

  return {
    found: true,
    task,
    maxIterations: maxMatch ? parseInt(maxMatch[1], 10) : undefined,
    marker: markerMatch?.[1],
    cleanedPrompt,
  }
}

/**
 * Build the initial prompt that gets sent to the AI
 * when starting an iteration loop
 *
 * @param task - The task to work on
 * @param maxIterations - Maximum number of iterations
 * @param marker - The completion marker the AI should output
 * @param userPrompt - Optional additional user prompt content (after tag removal)
 * @returns The formatted prompt to send to the AI
 *
 * @example
 * ```typescript
 * const prompt = buildIterationStartPrompt(
 *   "Build a REST API",
 *   20,
 *   "API_COMPLETE",
 *   "Make sure to include tests"
 * );
 * ```
 */
export function buildIterationStartPrompt(
  task: string,
  maxIterations: number,
  marker: string,
  userPrompt?: string
): string {
  const parts = [
    `[ITERATION LOOP STARTED - 1/${maxIterations}]`,
    "",
    `Task: ${task}`,
    "",
    `IMPORTANT: When this task is FULLY complete, output: <completion>${marker}</completion>`,
    "",
    "Begin working on this task now.",
  ]

  if (userPrompt && userPrompt.trim()) {
    parts.push("", "---", "", userPrompt.trim())
  }

  return parts.join("\n")
}
