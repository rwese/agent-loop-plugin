/**
 * @agent-loop/tools
 * Logger utility with file and console support
 */

import type { Logger, LogLevel } from "./types.js";

/**
 * Create a logger instance
 */
export function createLogger(source: string, level: LogLevel = "error"): Logger {
  // Silent level means no console output at all
  const shouldLog = (msgLevel: LogLevel): boolean => {
    if (level === "silent") {
      return false; // Never log to console when silent
    }
    
    const levels: LogLevel[] = ["silent", "error", "warn", "info", "debug"];
    return levels.indexOf(level) >= levels.indexOf(msgLevel);
  };

  return {
    debug: (message: string, data?: Record<string, unknown>) => {
      if (shouldLog("debug")) {
        console.debug(`[DEBUG] [${source}] ${message}`, data ?? "");
      }
    },
    info: (message: string, data?: Record<string, unknown>) => {
      if (shouldLog("info")) {
        console.info(`[INFO] [${source}] ${message}`, data ?? "");
      }
    },
    warn: (message: string, data?: Record<string, unknown>) => {
      if (shouldLog("warn")) {
        console.warn(`[WARN] [${source}] ${message}`, data ?? "");
      }
    },
    error: (message: string, data?: Record<string, unknown>) => {
      if (shouldLog("error")) {
        console.error(`[ERROR] [${source}] ${message}`, data ?? "");
      }
    },
  };
}
