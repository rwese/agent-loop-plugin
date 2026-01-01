/** Parse iteration loop tags from user prompts */

/** Result of parsing an iteration loop tag from a prompt */
export interface IterationLoopTagResult {
  found: boolean
  task?: string
  maxIterations?: number
  marker?: string
  cleanedPrompt: string
}

/** Parse <iterationLoop> tag from user prompt */
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

/** Build the initial prompt that gets sent to the AI when starting an iteration loop */
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
