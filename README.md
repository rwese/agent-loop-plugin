# Task Continuation Plugin

Minimal task continuation plugin for OpenCode - automatically continues sessions when incomplete tasks remain.

## Overview

This plugin provides automatic task continuation for OpenCode sessions. When a session becomes idle and incomplete todos remain, it automatically continues the session to complete pending tasks.

**Perfect for:**

- Multi-step task execution
- Preventing premature session termination
- Ensuring all tasks in a todo list are completed

**How it works:**

1. Monitors `session.idle` events
2. Checks for incomplete todos via `ctx.client.session.todo()`
3. Shows countdown toast notification via `ctx.client.tui.showToast()`
4. Injects continuation via `ctx.client.session.prompt()` with continuation prompt
5. Repeats until all todos are done

## Installation

```bash
npm install @rwese/agent-loop-plugin
```

## Usage

### Basic Usage

```typescript
import agentLoopPlugin from "@rwese/agent-loop-plugin"

// In your OpenCode configuration
export default agentLoopPlugin
```

### Custom Options

```typescript
import { createAgentLoopPlugin } from "@rwese/agent-loop-plugin"

const plugin = createAgentLoopPlugin({
  countdownSeconds: 3, // Seconds to wait before continuation
  errorCooldownMs: 5000, // Cooldown after errors
  toastDurationMs: 900, // Toast notification duration
  agent: "builder", // Agent name for continuations
  model: "claude-3-5-sonnet", // Model name for continuations
  debug: false, // Enable debug logging
  logFilePath: "./plugin.log", // Log file path
})

export default plugin
```

### Library Usage

For more control, use the core function directly:

```typescript
import { createTaskContinuation } from "@rwese/agent-loop-plugin"

export default function myPlugin(ctx: PluginContext) {
  const taskContinuation = createTaskContinuation(ctx, {
    countdownSeconds: 3,
    errorCooldownMs: 5000,
  })

  ctx.on("event", taskContinuation.handler)

  return { taskContinuation }
}
```

## OpenCode SDK Integration

This plugin uses the OpenCode SDK patterns for session interaction:

```typescript
interface PluginContext {
  directory: string
  client: {
    session: {
      prompt(opts: {
        path: { id: string }
        body: {
          agent?: string
          model?: string | { providerID: string; modelID: string }
          noReply?: boolean
          parts: Array<{ type: string; text: string; ignored?: boolean }>
        }
        query?: { directory: string }
      }): Promise<void>

      todo(opts: { path: { id: string } }): Promise<Todo[] | { data: Todo[] }>
    }

    tui: {
      showToast(opts: {
        body: {
          title: string
          message: string
          variant: "info" | "success" | "warning" | "error"
          duration: number
        }
      }): Promise<void>
    }
  }
}
```

## Features

- **Automatic Continuation**: Sessions continue automatically when tasks remain
- **Countdown Timer**: Visual countdown before continuation
- **User Cancellation**: User messages cancel pending continuations
- **Error Handling**: Graceful cooldown periods after errors
- **Completion Detection**: Detects when all tasks are complete
- **Message Filtering**: Correctly handles OpenCode message updates without cancelling countdowns
- **Session Tracking**: Tracks agent/model for consistent continuations

## Message Handling

OpenCode sends multiple `message.updated` events for the same message. This plugin correctly filters:

- **New User Messages**: Cancel the countdown (genuine user input)
- **Message Updates**: Do NOT cancel the countdown (summary updates, metadata changes)

This prevents message updates from incorrectly interrupting the auto-continuation flow.

## Configuration

| Option             | Type    | Default | Description                              |
| ------------------ | ------- | ------- | ---------------------------------------- |
| `countdownSeconds` | number  | 2       | Seconds to wait before auto-continuation |
| `errorCooldownMs`  | number  | 3000    | Cooldown period after errors             |
| `toastDurationMs`  | number  | 900     | Toast notification duration              |
| `agent`            | string  | -       | Agent name for continuation prompts      |
| `model`            | string  | -       | Model name for continuation prompts      |
| `debug`            | boolean | false   | Enable debug logging                     |
| `logFilePath`      | string  | -       | Path to log file for debugging           |

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build

# Lint
npm run lint

# Format
npm run format
```

## License

MIT
