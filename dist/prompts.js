import * as fs from "node:fs"
import * as path from "node:path"
export function loadPromptTemplate(filePath, placeholders) {
  try {
    if (!fs.existsSync(filePath)) {
      return null
    }
    const content = fs.readFileSync(filePath, "utf-8")
    let result = content
    for (const [key, value] of Object.entries(placeholders)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(value))
    }
    return result
  } catch {
    return null
  }
}
export function getDefaultContinuationPromptPath() {
  return path.join(process.cwd(), "prompts", "continuation.txt")
}
//# sourceMappingURL=prompts.js.map
