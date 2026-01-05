/**
 * Prompt loading utility for agent-loop-plugin
 *
 * Loads custom prompt templates from files with placeholder support.
 */

import * as fs from "node:fs"
import * as path from "node:path"

/**
 * Load a prompt template from file
 * Supports placeholders like {incompleteCount}, {todoList}, etc.
 */
export function loadPromptTemplate(
  filePath: string,
  placeholders: Record<string, string | number>
): string | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }

    const content = fs.readFileSync(filePath, "utf-8")

    // Replace placeholders with actual values
    let result = content
    for (const [key, value] of Object.entries(placeholders)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(value))
    }

    return result
  } catch {
    return null
  }
}

/**
 * Get the default continuation prompt template path
 */
export function getDefaultContinuationPromptPath(): string {
  return path.join(process.cwd(), "prompts", "continuation.txt")
}
