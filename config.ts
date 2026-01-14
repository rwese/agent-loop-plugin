/**
 * Configuration loading utility for agent-loop-plugin
 *
 * Loads default configuration from ~/.local/share/opencode/agent-loop-plugin.jsonc or .json
 * Falls back to hardcoded defaults if config file doesn't exist or is invalid.
 * Supports JSONC (JSON with Comments) for better user experience.
 */

import * as fs from "node:fs"
import * as path from "node:path"

/**
 * Configuration file names (checked in order)
 */
const CONFIG_FILE_NAMES = ["agent-loop-plugin.jsonc", "agent-loop-plugin.json"]

/**
 * Default configuration directory
 */
const CONFIG_DIR = ".local/share/opencode"

/**
 * Log file name
 */
const LOG_FILE_NAME = "agent-loop.log"

/**
 * Default plugin configuration
 */
export interface AgentLoopPluginOptions {
  taskLoop?: boolean
  /** Default countdown seconds before auto-continuation (default: 2) */
  countdownSeconds?: number
  /** Cooldown period in ms after errors (default: 3000) */
  errorCooldownMs?: number
  /** Toast notification duration in ms (default: 900) */
  toastDurationMs?: number
  /** Enable debug logging (default: true) */
  debug?: boolean
  /** Path to log file for writing logs */
  logFilePath?: string
  /** Path to custom continuation prompt template file */
}

/**
 * Internal configuration with all fields required
 */
interface InternalConfig {
  // All fields are required for internal use
  countdownSeconds: number
  errorCooldownMs: number
  toastDurationMs: number
  debug: boolean
  logFilePath: string | undefined
}

/**
 * Default configuration values
 */
const HARDCODED_DEFAULTS: InternalConfig = {
  countdownSeconds: 2,
  errorCooldownMs: 3000,
  toastDurationMs: 900,
  debug: true,
  logFilePath: getDefaultLogPath(),
}

/**
 * Get the configuration file path
 * Checks for .jsonc first, then .json
 */
function getConfigPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ""
  const configDir = path.join(homeDir, CONFIG_DIR)
  
  // Check for JSONC first, then JSON
  for (const fileName of CONFIG_FILE_NAMES) {
    const configPath = path.join(configDir, fileName)
    if (fs.existsSync(configPath)) {
      return configPath
    }
  }
  
  // Return the JSONC path as default (will fail gracefully if not exists)
  return path.join(configDir, CONFIG_FILE_NAMES[0])
}

/**
 * Get the default log file path
 */
export function getDefaultLogPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ""
  return path.join(homeDir, CONFIG_DIR, LOG_FILE_NAME)
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
 * Supports both JSON and JSONC formats
 * Returns null if file doesn't exist or is invalid
 */
function loadConfigFromFile(): AgentLoopPluginOptions | null {
  const configPath = getConfigPath()

  try {
    const content = fs.readFileSync(configPath, "utf-8")
    
    // Parse JSON or JSONC
    let config: Record<string, unknown>
    if (configPath.endsWith(".jsonc")) {
      // Simple JSONC parser - removes comments and trailing commas
      const cleanedContent = content
        .replace(/\/\/.*$/gm, "") // Remove single-line comments
        .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
        .replace(/,\s*([}\]])/g, "$1") // Remove trailing commas before } or ]
      
      config = JSON.parse(cleanedContent)
    } else {
      config = JSON.parse(content)
    }

    // Validate basic structure
    if (typeof config !== "object" || config === null) {
      console.warn("[agent-loop-plugin] Config file is not a valid JSON object")
      return null
    }

    // Return validated config (unknown properties are ignored)
    return {
      countdownSeconds: config.countdownSeconds as number | undefined,
      errorCooldownMs: config.errorCooldownMs as number | undefined,
      toastDurationMs: config.toastDurationMs as number | undefined,
      debug: config.debug as boolean | undefined,
      logFilePath: config.logFilePath as string | undefined,
    }
  } catch (error) {
    // Don't log error if file just doesn't exist - that's expected
    const err = error as { code?: string }
    if (err.code === 'ENOENT') {
      return null
    }
    
    // Only warn about unexpected errors
    console.warn(`[agent-loop-plugin] Failed to read config file: ${error}`)
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
