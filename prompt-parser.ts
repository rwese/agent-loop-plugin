/** Parse iteration loop tags from user prompts */

/** Result of parsing an iteration loop tag from a prompt */
export interface IterationLoopTagResult {
  found: boolean
  task?: string
  maxIterations?: number
  marker?: string
  cleanedPrompt: string
}

// Regex patterns for parsing iteration loop tags
const TAG_PATTERN = /<iterationLoop(?:\s+([^>]*))?>(\s*[\s\S]*?)<\/iterationLoop>/i
const SELF_CLOSING_PATTERN = /<iterationLoop\s+([\s\S]*?)\s*\/>/i

/** Extract attribute value from attributes string */
const getAttr = (
  attrs: string | undefined,
  name: string,
  isNumber = false
): string | number | undefined => {
  if (!attrs) return undefined
  const pattern = isNumber
    ? new RegExp(`${name}\\s*=\\s*["']?(\\d+)["']?`)
    : new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`)
  const match = attrs.match(pattern)
  return match ? (isNumber ? parseInt(match[1], 10) : match[1]) : undefined
}

/** Parse <iterationLoop> tag from user prompt */
export function parseIterationLoopTag(prompt: string): IterationLoopTagResult {
  // Try full tag first, then self-closing
  let match = prompt.match(TAG_PATTERN)
  let task: string | undefined
  let attributes: string | undefined
  let matchedPattern: RegExp | null = null

  if (match) {
    matchedPattern = TAG_PATTERN
    attributes = match[1]?.trim()
    task = match[2]?.trim()
  } else {
    match = prompt.match(SELF_CLOSING_PATTERN)
    if (match) {
      matchedPattern = SELF_CLOSING_PATTERN
      attributes = match[1]?.trim()
      task = getAttr(attributes, "task") as string | undefined
    }
  }

  if (!match || !matchedPattern) {
    return { found: false, cleanedPrompt: prompt }
  }

  return {
    found: true,
    task,
    maxIterations: getAttr(attributes, "max", true) as number | undefined,
    marker: getAttr(attributes, "marker") as string | undefined,
    cleanedPrompt: prompt
      .replace(matchedPattern, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  }
}

/** Build the initial prompt that gets sent to the AI when starting an iteration loop.
 *
 * NOTE: This prompt intentionally does NOT include completion marker instructions.
 * The completion instructions are only provided in the continuation prompt (on session.idle)
 * to prevent AI agents from prematurely outputting the done marker.
 */
export function buildIterationStartPrompt(
  task: string,
  maxIterations: number,
  _marker: string,
  userPrompt?: string
): string {
  const parts = [
    `[ITERATION LOOP STARTED - 1/${maxIterations}]`,
    "",
    `Task: ${task}`,
    "",
    "Begin working on this task now.",
  ]

  if (userPrompt && userPrompt.trim()) {
    parts.push("", "---", "", userPrompt.trim())
  }

  return parts.join("\n")
}
