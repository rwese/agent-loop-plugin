# Task Continuation Plugin

Minimal task continuation plugin for OpenCode - automatically continues sessions when incomplete tasks remain.

## Overview

This plugin provides task continuation functionality:

1. **Task Continuation**: Automatically continues sessions when incomplete todos remain

**Perfect for:**

- Multi-step task execution with automatic continuation
- Long-running agent workflows
- Preventing premature session termination
- Ensuring all tasks in a todo list are completed

## Installation

```bash
npm install @frugally3683/agent-loop-plugin
```

## Usage

```typescript
import agentLoopPlugin from "@frugally3683/agent-loop-plugin"

export default agentLoopPlugin
```

## Configuration

The plugin can be configured with the following options:

```typescript
{
  countdownSeconds: 2,        // Seconds to wait before auto-continuation
  errorCooldownMs: 3000,      // Cooldown period after errors
  toastDurationMs: 900,       // Toast notification duration
  agent: "custom-agent",      // Agent name for continuation prompts
  model: "custom-model",      // Model name for continuation prompts
  logFilePath: "path/to/log", // Path to log file for debugging
}
```

## Features

- **Automatic Continuation**: Sessions automatically continue when incomplete tasks remain
- **User Message Handling**: Cancels pending continuations when users send new messages
- **Error Handling**: Graceful handling of session errors with cooldown periods
- **Recovery Support**: Sessions can be marked as recovering to pause auto-continuation

## API

### Plugin Export

```typescript
import { agentLoopPlugin, createTaskContinuation } from "@frugally3683/agent-loop-plugin"
```

### Task Continuation API

```typescript
const continuation = createTaskContinuation(input, options)

continuation.handler({ event }) // Handle session events
continuation.cleanup() // Cleanup resources
continuation.scheduleContinuation(sessionID) // Manually schedule continuation
continuation.markRecovering(sessionID) // Mark session as recovering
continuation.markRecoveryComplete(sessionID) // Mark recovery as complete
continuation.cancel(sessionID) // Cancel pending continuation
```

## License

MIT
