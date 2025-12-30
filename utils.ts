/**
 * Utility functions for agent loops
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import type { IterationLoopState } from "./types"

/**
 * Simple frontmatter parser for loop state files
 */
export interface FrontmatterResult<T = Record<string, unknown>> {
  data: T
  body: string
}

export function parseFrontmatter<T = Record<string, unknown>>(
  content: string
): FrontmatterResult<T> {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
  const match = content.match(frontmatterRegex)

  if (!match) {
    return { data: {} as T, body: content }
  }

  const yamlContent = match[1]
  const body = match[2]

  const data: Record<string, string | boolean | number> = {}
  for (const line of yamlContent.split("\n")) {
    const colonIndex = line.indexOf(":")
    if (colonIndex !== -1) {
      const key = line.slice(0, colonIndex).trim()
      let value: string | boolean | number = line.slice(colonIndex + 1).trim()

      if (value === "true") value = true
      else if (value === "false") value = false
      else if (!isNaN(Number(value))) value = Number(value)

      data[key] = value
    }
  }

  return { data: data as T, body }
}

/**
 * Check if an error is an abort/cancellation error
 */
export function isAbortError(error: unknown): boolean {
  if (!error) return false

  if (typeof error === "object") {
    const errObj = error as Record<string, unknown>
    const name = errObj.name as string | undefined
    const message = (errObj.message as string | undefined)?.toLowerCase() ?? ""

    if (name === "MessageAbortedError" || name === "AbortError") return true
    if (name === "DOMException" && message.includes("abort")) return true
    if (
      message.includes("aborted") ||
      message.includes("cancelled") ||
      message.includes("interrupted")
    )
      return true
  }

  if (typeof error === "string") {
    const lower = error.toLowerCase()
    return lower.includes("abort") || lower.includes("cancel") || lower.includes("interrupt")
  }

  return false
}

/**
 * Get state file path for iteration loop
 */
export function getStateFilePath(directory: string, customPath?: string): string {
  const defaultPath = ".agent-loop/iteration-state.md"
  return customPath ? join(directory, customPath) : join(directory, defaultPath)
}

/**
 * Read Iteration Loop state from file
 */
export function readLoopState(directory: string, customPath?: string): IterationLoopState | null {
  const filePath = getStateFilePath(directory, customPath)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    const { data, body } = parseFrontmatter<Record<string, unknown>>(content)

    const active = data.active
    const iteration = data.iteration

    if (active === undefined || iteration === undefined) {
      return null
    }

    const isActive = active === true || active === "true"
    const iterationNum = typeof iteration === "number" ? iteration : Number(iteration)

    if (isNaN(iterationNum)) {
      return null
    }

    const stripQuotes = (val: unknown): string => {
      const str = String(val ?? "")
      return str.replace(/^["']|["']$/g, "")
    }

    return {
      active: isActive,
      iteration: iterationNum,
      max_iterations: Number(data.max_iterations) || 100,
      completion_marker: stripQuotes(data.completion_marker) || "DONE",
      started_at: stripQuotes(data.started_at) || new Date().toISOString(),
      prompt: body.trim(),
      session_id: data.session_id ? stripQuotes(data.session_id) : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Write Iteration Loop state to file
 */
export function writeLoopState(
  directory: string,
  state: IterationLoopState,
  customPath?: string
): boolean {
  const filePath = getStateFilePath(directory, customPath)

  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const sessionIdLine = state.session_id ? `session_id: "${state.session_id}"\n` : ""
    const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.max_iterations}
completion_marker: "${state.completion_marker}"
started_at: "${state.started_at}"
${sessionIdLine}---
${state.prompt}
`

    writeFileSync(filePath, content, "utf-8")
    return true
  } catch {
    return false
  }
}

/**
 * Clear Iteration Loop state file
 */
export function clearLoopState(directory: string, customPath?: string): boolean {
  const filePath = getStateFilePath(directory, customPath)

  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Increment Iteration Loop iteration counter
 */
export function incrementIteration(
  directory: string,
  customPath?: string
): IterationLoopState | null {
  const state = readLoopState(directory, customPath)
  if (!state) return null

  state.iteration += 1
  if (writeLoopState(directory, state, customPath)) {
    return state
  }
  return null
}

/**
 * Simple logger (can be replaced with custom implementation)
 */
export function log(message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${message}`, data ? JSON.stringify(data) : "")
}
