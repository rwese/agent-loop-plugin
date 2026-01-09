/**
 * Logger Utilities
 *
 * Provides logging functionality for the plugin system.
 * Supports both console logging and file-based logging.
 */

import type { Logger, LogLevel, PluginContext } from "./types.js";

/**
 * Logger implementation with configurable output
 */
class PluginLogger implements Logger {
  private logLevel: LogLevel;
  private logFilePath?: string;
  private source: string;
  private fileHandle?: Awaited<ReturnType<typeof import("node:fs/promises").open>>;

  constructor(options: {
    logLevel?: LogLevel;
    logFilePath?: string;
    source?: string;
  }) {
    this.logLevel = options.logLevel ?? "error";
    this.logFilePath = options.logFilePath;
    this.source = options.source ?? "plugin";
  }

  /**
   * Initialize file logging if path is provided
   */
  async init(): Promise<void> {
    if (this.logFilePath) {
      try {
        const fs = await import("node:fs/promises");
        this.fileHandle = await fs.open(this.logFilePath, "a");
      } catch {
        // Ignore file logging errors
      }
    }
  }

  /**
   * Write log entry to file if available
   */
  private async writeToFile(message: string, data?: Record<string, unknown>): Promise<void> {
    if (!this.fileHandle) return;

    try {
      const timestamp = new Date().toISOString();
      const dataStr = data ? ` ${JSON.stringify(data)}` : "";
      const logEntry = `[${timestamp}] [${this.source}] ${message}${dataStr}\n`;
      await this.fileHandle.write(logEntry);
    } catch {
      // Ignore write errors
    }
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["silent", "error", "warn", "info", "debug"];
    const currentIndex = levels.indexOf(this.logLevel);
    const targetIndex = levels.indexOf(level);
    return currentIndex >= targetIndex;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("debug")) {
      console.debug(`[DEBUG] [${this.source}] ${message}`, data ?? "");
      this.writeToFile(`DEBUG: ${message}`, data);
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("info")) {
      console.info(`[INFO] [${this.source}] ${message}`, data ?? "");
      this.writeToFile(`INFO: ${message}`, data);
    }
  }

  warn(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("warn")) {
      console.warn(`[WARN] [${this.source}] ${message}`, data ?? "");
      this.writeToFile(`WARN: ${message}`, data);
    }
  }

  error(message: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("error")) {
      console.error(`[ERROR] [${this.source}] ${message}`, data ?? "");
      this.writeToFile(`ERROR: ${message}`, data);
    }
  }

  /**
   * Cleanup file handle if open
   */
  async cleanup(): Promise<void> {
    if (this.fileHandle) {
      try {
        await this.fileHandle.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Global logger instance
 */
let globalLogger: PluginLogger | null = null;

/**
 * Initialize the global logger with client context
 */
export function initLogger(_client: PluginContext["client"]): void {
  globalLogger = new PluginLogger({ source: "agent-loop-plugin" });
}

/**
 * Create a logger instance
 */
export function createLogger(_source: string): Logger {
  if (!globalLogger) {
    globalLogger = new PluginLogger({ source: "agent-loop-plugin" });
  }
  return {
    debug: (message: string, data?: Record<string, unknown>) => globalLogger!.debug(message, data),
    info: (message: string, data?: Record<string, unknown>) => globalLogger!.info(message, data),
    warn: (message: string, data?: Record<string, unknown>) => globalLogger!.warn(message, data),
    error: (message: string, data?: Record<string, unknown>) => globalLogger!.error(message, data),
  };
}
