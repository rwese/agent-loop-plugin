# Agent Loop

Standalone agent loop mechanisms for OpenCode plugins, extracted from [oh-my-opencode](https://github.com/open-code-ai/oh-my-opencode).

## Overview

This module provides two complementary loop mechanisms for OpenCode plugins:

### 1. Task Loop

Automatically continues sessions when incomplete todos remain. Perfect for:

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

Iteration-based loop that continues until the agent signals completion via tool call. Perfect for:

- Long-running tasks with uncertain completion times
- Iterative refinement workflows
- Tasks that need multiple attempts

**How it works:**

1. Starts with a task prompt and max iterations
2. A unique codename is auto-generated (e.g., "CRIMSON_FALCON") to prevent pattern matching
3. Agent works on the task
4. On `session.idle`, prompts agent to review progress
5. Agent calls `iteration_loop_complete` tool when done
6. Stops when tool called or max iterations reached

## Installation

Copy the `agent-loop` directory into your project:

```bash
cp -r agent-loop /path/to/your/project/
```

Or install as a git submodule:

```bash
git submodule add <repository-url> agent-loop
```

## Dependencies

**Uses only Node.js built-ins:**

- `fs` - File system operations for Iteration Loop state persistence
- `path` - Path manipulation

No external dependencies required.

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
  stateFilePath: ".custom/path/state.md", // Optional custom path
})

// Start a loop - a unique codename is auto-generated
iterationLoop.startLoop(sessionID, "Build a REST API with authentication and user management", {
  maxIterations: 20,
})

// Check state
const state = iterationLoop.getState()
console.log(`Iteration: ${state?.iteration}/${state?.max_iterations}`)
console.log(`Codename: ${state?.completion_marker}`) // e.g., "SHADOW_PHOENIX"

// Complete the loop (call from tool handler)
iterationLoop.completeLoop(sessionID, "API fully implemented with tests")

// Cancel if needed
iterationLoop.cancelLoop(sessionID)
```

### Signaling Completion

The agent signals completion by calling the `iteration_loop_complete` tool:

```typescript
// In your tool handler:
iterationLoop.completeLoop(sessionID, "Task completed successfully")
```

This is more reliable than text-based markers because:

- Tool calls are explicit and unambiguous
- No regex parsing or pattern matching needed
- Immediate effect when tool is called
- Unique codenames prevent models from pattern-matching on previous completions

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

- In-memory session state tracking (errors, recovery status, timers)
- No file persistence needed

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
- `stateFilePath?: string` - Default: ".agent-loop/iteration-state.md"

**Returns:**

```typescript
interface IterationLoop {
  handler: (input: { event: LoopEvent }) => Promise<void>
  startLoop: (sessionID, prompt, options?) => boolean
  cancelLoop: (sessionID: string) => boolean
  completeLoop: (sessionID: string, summary?: string) => CompleteLoopResult
  getState: () => IterationLoopState | null
}

interface CompleteLoopResult {
  success: boolean
  iterations: number
  message: string
}
```

## Advanced Patterns

### Combining Both Loops

Use Iteration Loop for high-level iteration and Task Loop for sub-tasks:

```typescript
// Start Iteration Loop for overall task
// A unique codename is auto-generated (e.g., "ARCTIC_SENTINEL")
iterationLoop.startLoop(sessionID, "Implement feature X completely", {
  maxIterations: 10,
})

// Task Loop handles sub-tasks automatically
// 1. Agent creates todos for feature X
// 2. Task Loop keeps agent working on todos
// 3. When all todos done, session goes idle
// 4. Iteration Loop prompts agent to review progress
// 5. If not complete, agent continues working
// 6. When done, agent calls iteration_loop_complete tool
// 7. Process repeats until tool called or max iterations
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

## Plugin Tools

When using the Agent Loop as an OpenCode plugin (`.opencode/plugin/agent-loop.js`), the following tools are exposed for agent use:

### iteration_loop_start

Start an iteration loop for a complex task. A unique codename is auto-generated to prevent pattern matching.

**Arguments:**

| Name            | Type     | Required | Default | Description                                  |
| --------------- | -------- | -------- | ------- | -------------------------------------------- |
| `task`          | `string` | Yes      | -       | The task to work on iteratively              |
| `maxIterations` | `number` | No       | 10      | Maximum number of iterations before stopping |

**Usage:**

The agent should call this tool when:

1. It encounters an `<iterationLoop>` tag in a user prompt
2. A task requires multiple iterations to complete
3. Long-running tasks need structured continuation

**Example tool call:**

```json
{
  "task": "Refactor all components to use the new design system",
  "maxIterations": 15
}
```

**Response:**

```
Iteration loop started successfully!

Task: Refactor all components to use the new design system
Max Iterations: 15
Codename: CRIMSON_FALCON

IMPORTANT:
- When this task is FULLY complete, you MUST call the iteration_loop_complete tool
- The loop will automatically continue when the session goes idle

Begin working on this task now.
```

### iteration_loop_complete

Signal that the iteration loop task is complete. **This is the preferred way to stop the loop.**

**Arguments:**

| Name      | Type     | Required | Default | Description                           |
| --------- | -------- | -------- | ------- | ------------------------------------- |
| `summary` | `string` | No       | -       | Optional summary of what was achieved |

**Usage:**

Call this tool when the task is fully complete:

```json
{
  "summary": "All components refactored, tests passing"
}
```

**Response:**

```
Iteration loop completed successfully!

Iterations: 5
Summary: All components refactored, tests passing
```

### iteration_loop_cancel

Cancel the active iteration loop.

**Arguments:** None

**Usage:** Call when the iteration loop should be stopped prematurely (task abandoned).

### iteration_loop_status

Get the current status of the iteration loop.

**Arguments:** None

**Response:**

```
Iteration Loop Status:
- Active: true
- Iteration: 3/15
- Codename: CRIMSON_FALCON
- Started At: 2025-12-30T10:30:00.000Z
- Task: Refactor all components to use the new design system
```

## Plugin Configuration

The plugin is configured via environment variables:

| Variable                       | Default     | Description                                 |
| ------------------------------ | ----------- | ------------------------------------------- |
| `AGENT_LOOP_COUNTDOWN_SECONDS` | `5`         | Countdown before auto-continue (Task Loop)  |
| `AGENT_LOOP_ERROR_COOLDOWN_MS` | `3000`      | Error cooldown in milliseconds              |
| `AGENT_LOOP_TOAST_DURATION_MS` | `900`       | Toast notification duration in milliseconds |
| `AGENT_LOOP_MAX_ITERATIONS`    | `10`        | Default max iterations (Iteration Loop)     |
| `AGENT_LOOP_LOG_LEVEL`         | `"info"`    | Log level: silent, error, warn, info, debug |
| `AGENT_LOOP_HELP_AGENT`        | `"advisor"` | Subagent name for help/feedback             |

Note: Completion markers are now auto-generated as unique codenames (e.g., "SHADOW_PHOENIX") to prevent models from pattern-matching on previous completions.

## Plugin Integration

### Installation

Copy the plugin to your OpenCode plugins directory:

```bash
mkdir -p .opencode/plugin
cp -r dist/ .opencode/plugin/agent-loop/
```

Or reference the local development version:

```javascript
// .opencode/plugin/agent-loop.js
import { AgentLoopPlugin } from "../../dist/index.js"
export const main = AgentLoopPlugin
```

### Plugin Exports

The plugin exposes additional methods for programmatic control:

```typescript
const plugin = await AgentLoopPlugin({ directory, client })

// Iteration Loop controls
plugin.startIterationLoop(sessionID, prompt, options)
plugin.cancelIterationLoop(sessionID)
plugin.getIterationLoopState()

// Task Loop controls
plugin.pauseTaskLoop(sessionID)
plugin.resumeTaskLoop(sessionID)
plugin.cleanupTaskLoop(sessionID)

// Status messages (visible in UI but not added to model context)
plugin.sendStatusMessage(sessionID, "Processing...")

// Direct access to loop instances
plugin.loops.task
plugin.loops.iteration
```

## Differences from oh-my-opencode

This standalone version omits:

- Background task manager integration
- Message storage/transcript inspection (for write permission checks)
- Session state tracking (main session vs subagent)
- Agent-specific filtering (planner mode detection)
- oh-my-opencode config system

As a result, this version is:

- More portable across projects
- Easier to understand and modify
- Simpler to integrate into existing plugins
- Free of external dependencies

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
