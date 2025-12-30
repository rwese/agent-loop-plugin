# Agent Loop

Standalone agent loop mechanisms extracted from [oh-my-opencode](https://github.com/open-code-ai/oh-my-opencode).

## Overview

This module provides two complementary loop mechanisms for OpenCode plugins:

### 1. Task Loop

Automatically continues sessions when incomplete tasks remain. Perfect for:

- Multi-step task execution
- Preventing premature session termination
- Ensuring all tasks in a list are completed

**How it works:**

1. Monitors `session.idle` events
2. Checks for incomplete todos
3. Shows countdown toast notification
4. Injects continuation prompt if todos remain
5. Repeats until all todos are done

### 2. Iteration Loop

Iteration-based loop that continues until a completion marker is detected. Perfect for:

- Long-running tasks with uncertain completion time
- Iterative refinement workflows
- Tasks that need multiple attempts

**How it works:**

1. Starts with a task prompt and max iterations
2. Agent works on the task
3. On `session.idle`, checks for completion marker: `<completion>DONE</completion>`
4. If not found, increments iteration and continues
5. Stops when marker detected or max iterations reached

## Installation

Simply copy the `agent-loop` directory into your project:

```bash
cp -r agent-loop /path/to/your/project/
```

Or install as a git submodule:

```bash
git submodule add <repository-url> agent-loop
```

## Dependencies

**Minimal Node.js built-ins only:**

- `fs` - File system operations (for Iteration Loop state persistence)
- `path` - Path manipulation

**No external dependencies required!**

## Usage

### Basic Setup

```typescript
import { createTaskLoop, createIterationLoop } from "./agent-loop"
import type { PluginContext } from "./agent-loop"

export default function myPlugin(ctx: PluginContext) {
  // Create loops
  const taskLoop = createTaskLoop(ctx)
  const iterationLoop = createIterationLoop(ctx)

  // Wire into event system
  ctx.on("event", async (event) => {
    await taskLoop.handler({ event })
    await iterationLoop.handler({ event })
  })

  return { taskLoop, iterationLoop }
}
```

### Task Loop

```typescript
const taskLoop = createTaskLoop(ctx, {
  countdownSeconds: 3, // Wait 3 seconds before continuing
  errorCooldownMs: 5000, // Wait 5 seconds after errors
  toastDurationMs: 1000, // Toast notification duration
})

// Control loop behavior
taskLoop.markRecovering(sessionID) // Pause during recovery
taskLoop.markRecoveryComplete(sessionID) // Resume
taskLoop.cleanup(sessionID) // Clean up session state
```

### Iteration Loop

```typescript
const iterationLoop = createIterationLoop(ctx, {
  defaultMaxIterations: 100,
  defaultCompletionMarker: "DONE",
  stateFilePath: ".custom/path/state.md", // Optional custom path
})

// Start a loop
iterationLoop.startLoop(sessionID, "Build a REST API with authentication and user management", {
  maxIterations: 20,
  completionMarker: "API_READY",
})

// Check state
const state = iterationLoop.getState()
console.log(`Iteration: ${state?.iteration}/${state?.max_iterations}`)

// Cancel if needed
iterationLoop.cancelLoop(sessionID)
```

### Completion Marker

The agent must output the completion marker when done:

```
Task is complete!

<completion>DONE</completion>
```

Or with custom marker:

```
API is fully implemented and tested.

<completion>API_READY</completion>
```

## Architecture

### Event-Driven Design

Both loops are event-driven and respond to OpenCode events:

| Event             | Task Loop                        | Iteration Loop                       |
| ----------------- | -------------------------------- | ------------------------------------ |
| `session.idle`    | Check todos, inject continuation | Check completion, continue iteration |
| `session.error`   | Pause continuation               | Mark recovering                      |
| `session.deleted` | Clean up state                   | Clear loop state                     |
| `message.updated` | Cancel countdown (user message)  | -                                    |
| `tool.execute.*`  | Cancel countdown                 | -                                    |

### State Management

**Task Loop:**

- In-memory session state (errors, recovery, timers)
- No persistence needed

**Iteration Loop:**

- File-based state persistence (`.agent-loop/iteration-state.md`)
- Frontmatter format with iteration tracking
- Survives process restarts

Example Iteration Loop state file:

```markdown
---
active: true
iteration: 3
max_iterations: 20
completion_marker: "API_READY"
started_at: "2025-12-30T10:30:00.000Z"
session_id: "abc123"
---

Build a REST API with authentication and user management
```

## API Reference

### Types

#### PluginContext

```typescript
interface PluginContext {
  directory: string;
  client: {
    session: {
      prompt(opts: { ... }): Promise<void>;
      todo(opts: { ... }): Promise<Todo[]>;
    };
    tui: {
      showToast(opts: { ... }): Promise<void>;
    };
  };
}
```

#### Todo

```typescript
interface Todo {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority: string
}
```

### createTaskLoop()

```typescript
function createTaskLoop(ctx: PluginContext, options?: TaskLoopOptions): TaskLoop
```

**Options:**

- `countdownSeconds?: number` - Default: 2
- `errorCooldownMs?: number` - Default: 3000
- `toastDurationMs?: number` - Default: 900

**Returns:**

```typescript
interface TaskLoop {
  handler: (input: { event: LoopEvent }) => Promise<void>
  markRecovering: (sessionID: string) => void
  markRecoveryComplete: (sessionID: string) => void
  cleanup: (sessionID: string) => void
}
```

### createIterationLoop()

```typescript
function createIterationLoop(ctx: PluginContext, options?: IterationLoopOptions): IterationLoop
```

**Options:**

- `defaultMaxIterations?: number` - Default: 100
- `defaultCompletionMarker?: string` - Default: "DONE"
- `stateFilePath?: string` - Default: ".agent-loop/iteration-state.md"

**Returns:**

```typescript
interface IterationLoop {
  handler: (input: { event: LoopEvent }) => Promise<void>
  startLoop: (sessionID, prompt, options?) => boolean
  cancelLoop: (sessionID: string) => boolean
  getState: () => IterationLoopState | null
}
```

## Advanced Patterns

### Combining Both Loops

Use Iteration Loop for high-level iteration and Task Loop for sub-tasks:

```typescript
// Start Iteration Loop for overall task
iterationLoop.startLoop(sessionID, "Implement feature X completely", {
  maxIterations: 10,
  completionMarker: "FEATURE_COMPLETE",
})

// Task Loop handles sub-tasks automatically
// 1. Agent creates todos for feature X
// 2. Task Loop keeps agent working on todos
// 3. When all todos done, session goes idle
// 4. Iteration Loop checks for <completion>FEATURE_COMPLETE</completion>
// 5. If not found, starts iteration 2
// 6. Process repeats until completion or max iterations
```

### Error Recovery

```typescript
ctx.on("event", async (event) => {
  if (event.type === "session.error") {
    const sessionID = event.properties?.sessionID

    // Pause loops during recovery
    taskLoop.markRecovering(sessionID)

    // Your recovery logic here
    await handleError(event.properties?.error)

    // Resume loops
    taskLoop.markRecoveryComplete(sessionID)
  }

  await taskLoop.handler({ event })
  await iterationLoop.handler({ event })
})
```

## Differences from oh-my-opencode

This standalone version removes:

- Background task manager integration
- Message storage/transcript inspection (for write permission checks)
- Session state tracking (main session vs subagent)
- Agent-specific filtering (planner mode detection)
- oh-my-opencode config system

This makes it:

- More portable
- Easier to understand
- Simpler to integrate
- No external dependencies

If you need these features, use the full [oh-my-opencode](https://github.com/open-code-ai/oh-my-opencode) plugin.

## Testing

Run tests with:

```bash
npm test
```

Or manually test with a simple plugin:

```typescript
// test-plugin.ts
import { createTaskLoop, createIterationLoop } from "./agent-loop"

export default function testPlugin(ctx: any) {
  const taskLoop = createTaskLoop(ctx)
  const iterationLoop = createIterationLoop(ctx)

  ctx.on("event", async (event: any) => {
    console.log("Event:", event.type)
    await taskLoop.handler({ event })
    await iterationLoop.handler({ event })
  })

  // Test Iteration Loop
  if (ctx.command === "test-iteration") {
    iterationLoop.startLoop("test-session", "Test task", {
      maxIterations: 3,
      completionMarker: "TEST_DONE",
    })
  }

  return { taskLoop, iterationLoop }
}
```

## License

MIT (same as oh-my-opencode)

## Credits

Extracted and simplified from [oh-my-opencode](https://github.com/open-code-ai/oh-my-opencode) by the OpenCode community.
