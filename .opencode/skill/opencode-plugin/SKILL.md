# OpenCode Plugin Development

## Overview

OpenCode plugins are modular extensions that hook into the OpenCode agent loop system. They can intercept tool executions, transform messages, handle events, and modify configuration. This skill covers how to build, configure, and structure OpenCode plugins.

## Core Architecture

### Plugin Structure

Every OpenCode plugin follows a consistent pattern:

```typescript
// index.ts
import type { Plugin } from "@opencode-ai/plugin"

const plugin: Plugin = async (ctx) => {
  return {
    "experimental.chat.system.transform": async (input, output) => {
      /* ... */
    },
    "experimental.chat.messages.transform": async (input, output) => {
      /* ... */
    },
    "tool.execute.before": async (input, output) => {
      /* ... */
    },
    "tool.execute.after": async (input, output) => {
      /* ... */
    },
    "command.execute.before": async (input, output) => {
      /* ... */
    },
    event: async ({ event }) => {
      /* ... */
    },
    config: async (opencodeConfig) => {
      /* ... */
    },
  }
}

export default plugin
```

### Package Configuration

```json
{
  "name": "@yourname/opencode-yourplugin",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "peerDependencies": {
    "@opencode-ai/plugin": ">=1.0.0"
  },
  "dependencies": {
    "@opencode-ai/sdk": "latest"
  },
  "scripts": {
    "build": "tsc",
    "dev": "opencode plugin dev",
    "typecheck": "tsc --noEmit"
  }
}
```

## Installation Pattern

Plugins are installed in OpenCode's configuration file:

```json
// ~/.config/opencode/opencode.jsonc
{
  "plugins": ["@yourname/opencode-yourplugin@latest"]
}
```

Plugins are loaded when OpenCode starts. Restart OpenCode after configuration changes.

## Hook System

OpenCode provides a comprehensive hook system for plugin interception:

### Chat Transforms

```typescript
// Transform system prompt
"experimental.chat.system.transform": async (input, output) => {
  const systemText = output.system.join("\n")
  // Modify system prompt
  output.system.push("Your custom instructions")
}

// Transform chat messages
"experimental.chat.messages.transform": async (input, output) => {
  for (const message of output.messages) {
    for (const part of message.parts) {
      // Modify message parts
    }
  }
}
```

### Tool Execution Hooks

```typescript
// Before tool execution
"tool.execute.before": async (input, output) => {
  if (input.tool === "task") {
    // Modify tool arguments
    output.args.prompt = "Modified prompt"
  }
}

// After tool execution
"tool.execute.after": async (input, output) => {
  if (input.tool === "task") {
    // Process tool output
    console.log("Tool result:", output.result)
  }
}
```

### Command Execution Hooks

```typescript
// Before command execution
"command.execute.before": async (input, output) => {
  console.log("Executing command:", input.command)
  console.log("With arguments:", input.arguments)

  // Modify command parts
  for (const part of output.parts) {
    if (part.type === "subtask") {
      part.agent = "build"
    }
  }
}
```

### Event Handling

```typescript
"event": async ({ event }) => {
  switch (event.type) {
    case "session.idle":
      console.log("Session idle:", event.properties.sessionID)
      break
    case "message.updated":
      console.log("Message updated")
      break
    case "session.error":
      console.log("Session error:", event.properties.error)
      break
    case "session.deleted":
      console.log("Session deleted")
      break
  }
}
```

### Configuration Mutation

```typescript
"config": async (opencodeConfig) => {
  // Add tools to primary_tools
  const existingTools = opencodeConfig.experimental?.primary_tools ?? []
  opencodeConfig.experimental = {
    ...opencodeConfig.experimental,
    primary_tools: [...existingTools, "your-tool-name"]
  }
}
```

## Configuration Patterns

### Pattern 1: Constructor Options

For simple plugins with limited configuration:

```typescript
// src/index.ts
export interface PluginOptions {
  enabled?: boolean
  debug?: boolean
  customSetting?: string
}

const DEFAULT_OPTIONS: PluginOptions = {
  enabled: true,
  debug: false,
  customSetting: "default",
}

export const yourPlugin = (options: PluginOptions = {}): Plugin => {
  const config = { ...DEFAULT_OPTIONS, ...options }

  return ({ client }) => {
    return {
      // Plugin hooks with access to config
    }
  }
}

export default yourPlugin
```

### Pattern 2: Dedicated Config File

For complex plugins with extensive configuration:

**Config File Locations (precedence order):**

1. Project: `.opencode/pluginname.jsonc`
2. Config dir: `$OPENCODE_CONFIG_DIR/pluginname.jsonc`
3. Global: `~/.config/opencode/pluginname.jsonc`

**Configuration Example:**

```jsonc
// ~/.config/opencode/pluginname.jsonc
{
  "enabled": true,
  "debug": false,
  "features": {
    "featureA": {
      "enabled": true,
      "option1": "value1",
    },
    "featureB": {
      "enabled": false,
    },
  },
  "protectedTools": ["task", "todowrite"],
}
```

**Implementation:**

```typescript
import fs from "fs"
import path from "path"
import { parse } from "jsonc-parser"

interface PluginConfig {
  enabled: boolean
  debug: boolean
  features: Record<string, any>
  protectedTools: string[]
}

const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  debug: false,
  features: {},
  protectedTools: ["task", "todowrite"],
}

const getConfigPath = (ctx: any): string => {
  const paths = [
    path.join(ctx.directory, ".opencode", "pluginname.jsonc"),
    path.join(process.env.OPENCODE_CONFIG_DIR || "", "pluginname.jsonc"),
    path.join(process.env.HOME || "", ".config", "opencode", "pluginname.jsonc"),
  ]

  return paths.find((p) => fs.existsSync(p)) || paths[0]
}

const loadConfig = (ctx: any): PluginConfig => {
  const configPath = getConfigPath(ctx)

  try {
    const content = fs.readFileSync(configPath, "utf-8")
    const userConfig = parse(content)
    return { ...DEFAULT_CONFIG, ...userConfig }
  } catch {
    return DEFAULT_CONFIG
  }
}
```

### Pattern 3: Mixed Approach

Combine constructor options with config file overrides:

```typescript
export interface PluginOptions {
  // Constructor options
  enabled?: boolean
  debug?: boolean

  // Config file path override
  configPath?: string
}

export const yourPlugin = (options: PluginOptions = {}): Plugin => {
  return (ctx) => {
    // Load config from file
    const fileConfig = loadConfig(ctx, options.configPath)

    // Merge with constructor options
    const config = {
      ...fileConfig,
      ...options,
      enabled: options.enabled ?? fileConfig.enabled,
      debug: options.debug ?? fileConfig.debug,
    }

    return {
      // Plugin hooks
    }
  }
}
```

## State Management

### Session-Based State

```typescript
// Track state per session
const sessionState = new Map<
  string,
  {
    counter: number
    lastAction: string
  }
>()

const plugin: Plugin = async (ctx) => {
  return {
    "tool.execute.before": async (input) => {
      const state = sessionState.get(input.sessionID) ?? { counter: 0, lastAction: "" }
      state.counter++
      state.lastAction = input.tool
      sessionState.set(input.sessionID, state)
    },
    "session.deleted": async ({ properties }) => {
      sessionState.delete(properties.sessionID)
    },
  }
}
```

### Plugin-Level State

```typescript
// Global state across all sessions
let pluginInitialized = false
const globalConfig = new Map<string, any>()

const plugin: Plugin = async (ctx) => {
  if (!pluginInitialized) {
    pluginInitialized = true
    // Initialize global state
  }

  return {
    // Hooks
  }
}
```

## Best Practices

### 1. Error Handling

```typescript
const plugin: Plugin = async (ctx) => {
  return {
    "tool.execute.before": async (input, output) => {
      try {
        // Your logic
      } catch (error) {
        console.error("Plugin error:", error)
        // Optionally modify output to handle error
      }
    },
  }
}
```

### 2. Logging

```typescript
const plugin: Plugin = async (ctx) => {
  const debug = false // Should come from config

  const log = (...args: any[]) => {
    if (debug) {
      console.log("[plugin-name]", ...args)
    }
  }

  return {
    // Hooks with logging
  }
}
```

### 3. Type Safety

```typescript
import type { Plugin } from "@opencode-ai/plugin"

// Type-safe hook handlers
const plugin: Plugin = async (ctx) => {
  return {
    "tool.execute.before": async (
      input: {
        tool: string
        sessionID: string
        callID: string
      },
      output: { args: any }
    ) => {
      // Fully typed
    },
  }
}
```

### 4. Config Precedence

When using config files, follow this precedence:

```
Defaults → Global config → Config dir config → Project config → Constructor options
```

### 5. Protected Tools

Always protect essential tools from modification:

```typescript
const PROTECTED_TOOLS = ["task", "todowrite", "todoread", "write", "edit"]

const shouldProtect = (toolName: string): boolean => {
  return PROTECTED_TOOLS.includes(toolName)
}
```

## Tool Creation

### Creating Custom Tools

```typescript
const plugin: Plugin = async (ctx) => {
  return {
    tool: {
      customTool: async (input, sessionID) => {
        // Tool implementation
        return { success: true, data: "result" }
      },
    },
    config: async (opencodeConfig) => {
      const existingTools = opencodeConfig.experimental?.primary_tools ?? []
      opencodeConfig.experimental = {
        ...opencodeConfig.experimental,
        primary_tools: [...existingTools, "customTool"],
      }
    },
  }
}
```

## Common Use Cases

### 1. Context Management

```typescript
// Remove or transform context entries
"experimental.chat.messages.transform": async (input, output) => {
  for (const message of output.messages) {
    message.parts = message.parts.filter(part => {
      // Filter out unwanted parts
      return keepPart(part)
    })
  }
}
```

### 2. Session Monitoring

```typescript
"event": async ({ event }) => {
  if (event.type === "session.idle") {
    // Trigger notifications or cleanup
    await handleIdleSession(event.properties.sessionID)
  }
}
```

### 3. Workflow Orchestration

```typescript
"command.execute.before": async (input, output) => {
  if (input.command === "/build") {
    // Modify build workflow
    output.parts = [
      { type: "subtask", agent: "researcher", prompt: "Research..." },
      { type: "subtask", agent: "builder", prompt: "Implement..." }
    ]
  }
}
```

## Configuration Examples

### Minimal Plugin

```typescript
// index.ts
import type { Plugin } from "@opencode-ai/plugin"

const plugin: Plugin = async () => {
  return {
    event: async ({ event }) => {
      console.log("Event received:", event.type)
    },
  }
}

export default plugin
```

### Feature-Rich Plugin

```typescript
// index.ts
import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig } from "./lib/config"
import { createCustomTool } from "./lib/tools"

interface PluginConfig {
  enabled: boolean
  debug: boolean
  features: {
    tool: boolean
    transform: boolean
    event: boolean
  }
}

const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  debug: false,
  features: {
    tool: true,
    transform: true,
    event: true,
  },
}

const plugin: Plugin = async (ctx) => {
  const config = loadConfig<PluginConfig>(ctx, "yourplugin.jsonc", DEFAULT_CONFIG)

  if (!config.enabled) {
    return {}
  }

  return {
    ...(config.features.tool && {
      tool: {
        customTool: createCustomTool(ctx),
      },
    }),
    ...(config.features.transform && {
      "experimental.chat.messages.transform": async (input, output) => {
        if (config.debug) {
          console.log("Transforming messages")
        }
      },
    }),
    ...(config.features.event && {
      event: async ({ event }) => {
        console.log("Event:", event.type)
      },
    }),
  }
}

export default plugin
```

## Debugging Tips

### 1. Development Mode

```bash
opencode plugin dev
```

### 2. Logging

```typescript
const log = (message: string, data?: any) => {
  if (config.debug) {
    console.log(`[plugin-name] ${message}`, data ?? "")
  }
}

log("Processing message", { sessionID: input.sessionID })
```

### 3. TypeScript Checking

```bash
npm run typecheck
```

## Testing

### Basic Test Structure

```typescript
// __tests__/plugin.test.ts
import { describe, it, expect, vi } from "vitest"
import plugin from "../index"

describe("Plugin", () => {
  it("should export a function", () => {
    expect(typeof plugin).toBe("function")
  })

  it("should return a plugin object", async () => {
    const ctx = { client: {}, directory: "/tmp" }
    const result = await plugin(ctx)
    expect(result).toHaveProperty("tool")
    expect(result).toHaveProperty("event")
  })
})
```

## Summary

OpenCode plugins are powerful extensions that can:

- Intercept and transform tool executions
- Modify chat messages and system prompts
- Handle system events
- Add custom tools
- Mutate OpenCode configuration

Key takeaways:

- Use constructor options for simple, plugin-specific settings
- Use config files for complex, user-customizable behavior
- Leverage the hook system for maximum flexibility
- Follow the established patterns for consistency
- Implement proper error handling and logging

## References

- [@opencode-ai/plugin](https://www.npmjs.com/package/@opencode-ai/plugin) - Core plugin types
- [@opencode-ai/sdk](https://www.npmjs.com/package/@opencode-ai/sdk) - SDK utilities
- [Dynamic Context Pruning](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning) - Example plugin
- [Subtask2](https://github.com/spoons-and-mirrors/subtask2) - Example plugin
- [OpenCode Plugins](https://github.com/ericc-ch/opencode-plugins) - Plugin collection
