/**
 * Configuration loading utility for agent-loop-plugin
 *
 * Loads default configuration from ~/.config/opencode/agent-loop-plugin.json
 * Falls back to hardcoded defaults if config file doesn't exist or is invalid.
 */

import * as fs from "node:fs"
import * as path from "node:path"

/**
 * Configuration file name
 */
const CONFIG_FILE_NAME = "agent-loop-plugin.json"

/**
 * Default configuration directory
 */
const CONFIG_DIR = ".config/opencode"

/**
 * Default plugin configuration
 */
export interface AgentLoopPluginOptions {
  /** Enable task loop functionality (default: true) */
  taskLoop?: boolean
  /** Enable iteration loop functionality (default: true) */
  iterationLoop?: boolean
  /** Default countdown seconds before auto-continuation (default: 2) */
  countdownSeconds?: number
  /** Cooldown period in ms after errors (default: 3000) */
  errorCooldownMs?: number
  /** Toast notification duration in ms (default: 900) */
  toastDurationMs?: number
  /** Agent name for continuation prompts */
  agent?: string
  /** Model name for continuation prompts */
  model?: string
  /** Enable debug logging (default: true) */
  debug?: boolean
  /** Path to log file for writing logs */
  logFilePath?: string
}

/**
 * Internal configuration with all fields required
 */
interface InternalConfig {
  // All fields are required for internal use
  taskLoop: boolean
  iterationLoop: boolean
  countdownSeconds: number
  errorCooldownMs: number
  toastDurationMs: number
  agent: string | undefined
  model: string | undefined
  debug: boolean
  logFilePath: string | undefined
}

/**
 * Default configuration values
 */
const HARDCODED_DEFAULTS: InternalConfig = {
  taskLoop: true,
  iterationLoop: true,
  countdownSeconds: 2,
  errorCooldownMs: 3000,
  toastDurationMs: 900,
  agent: undefined,
  model: undefined,
  debug: true,
  logFilePath: undefined,
}

/**
 * Get the configuration file path
 */
function getConfigPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ""
  return path.join(homeDir, CONFIG_DIR, CONFIG_FILE_NAME)
}

/**
 * Check if configuration file exists
 */
function configFileExists(): boolean {
  try {
    const configPath = getConfigPath()
    return fs.existsSync(configPath)
  } catch {
    return false
  }
}

/**
 * Load configuration from file
 * Returns null if file doesn't exist or is invalid
 */
function loadConfigFromFile(): AgentLoopPluginOptions | null {
  const configPath = getConfigPath()

  try {
    const content = fs.readFileSync(configPath, "utf-8")
    const config = JSON.parse(content)

    // Validate basic structure
    if (typeof config !== "object" || config === null) {
      console.warn("[agent-loop-plugin] Config file is not a valid JSON object")
      return null
    }

    // Return validated config (unknown properties are ignored)
    return {
      taskLoop: config.taskLoop,
      iterationLoop: config.iterationLoop,
      countdownSeconds: config.countdownSeconds,
      errorCooldownMs: config.errorCooldownMs,
      toastDurationMs: config.toastDurationMs,
      agent: config.agent,
      model: config.model,
      debug: config.debug,
      logFilePath: config.logFilePath,
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.warn("[agent-loop-plugin] Config file contains invalid JSON")
    } else {
      console.warn(`[agent-loop-plugin] Failed to read config file: ${error}`)
    }
    return null
  }
}

/**
 * Merge user options with defaults
 */
function mergeWithDefaults(options: AgentLoopPluginOptions = {}): InternalConfig {
  const fileConfig = loadConfigFromFile()

  // Priority order:
  // 1. User-provided options (highest priority)
  // 2. File-based configuration
  // 3. Hardcoded defaults (lowest priority)

  const effectiveConfig = {
    ...HARDCODED_DEFAULTS,
    ...(fileConfig || {}),
    ...options,
  }

  return effectiveConfig
}

/**
 * Get the effective configuration for the plugin
 *
 * @param options - User-provided configuration options
 * @returns Merged configuration with all required fields
 */
export function getEffectiveConfig(options: AgentLoopPluginOptions = {}): InternalConfig {
  return mergeWithDefaults(options)
}

/**
 * Get the configuration file path (for debugging/information purposes)
 */
export function getConfigFilePath(): string {
  return getConfigPath()
}

/**
 * Check if configuration file exists and is valid
 */
export function isConfigFileValid(): boolean {
  return configFileExists() && loadConfigFromFile() !== null
}

/**
 * Get a summary of the current configuration source
 */
export function getConfigSourceInfo(): {
  path: string
  exists: boolean
  source: "file" | "defaults"
} {
  const configPath = getConfigPath()
  const fileExists = configFileExists()
  const fileConfig = fileExists ? loadConfigFromFile() : null

  return {
    path: configPath,
    exists: fileExists && fileConfig !== null,
    source: fileConfig !== null ? "file" : "defaults",
  }
}
