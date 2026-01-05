import * as fs from "node:fs"
import * as path from "node:path"
const CONFIG_FILE_NAME = "agent-loop-plugin.json"
const CONFIG_DIR = ".config/opencode"
const HARDCODED_DEFAULTS = {
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
function getConfigPath() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || ""
  return path.join(homeDir, CONFIG_DIR, CONFIG_FILE_NAME)
}
function configFileExists() {
  try {
    const configPath = getConfigPath()
    return fs.existsSync(configPath)
  } catch {
    return false
  }
}
function loadConfigFromFile() {
  const configPath = getConfigPath()
  try {
    const content = fs.readFileSync(configPath, "utf-8")
    const config = JSON.parse(content)
    if (typeof config !== "object" || config === null) {
      console.warn("[agent-loop-plugin] Config file is not a valid JSON object")
      return null
    }
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
function mergeWithDefaults(options = {}) {
  const fileConfig = loadConfigFromFile()
  const effectiveConfig = {
    ...HARDCODED_DEFAULTS,
    ...(fileConfig || {}),
    ...options,
  }
  return effectiveConfig
}
export function getEffectiveConfig(options = {}) {
  return mergeWithDefaults(options)
}
export function getConfigFilePath() {
  return getConfigPath()
}
export function isConfigFileValid() {
  return configFileExists() && loadConfigFromFile() !== null
}
export function getConfigSourceInfo() {
  const configPath = getConfigPath()
  const fileExists = configFileExists()
  const fileConfig = fileExists ? loadConfigFromFile() : null
  return {
    path: configPath,
    exists: fileExists && fileConfig !== null,
    source: fileConfig !== null ? "file" : "defaults",
  }
}
//# sourceMappingURL=config.js.map
