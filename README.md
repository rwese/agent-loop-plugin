# Task Continuation & Goal Management Plugin

Minimal task continuation and goal management plugin for OpenCode - automatically continues sessions when incomplete tasks remain and provides structured goal tracking for AI agents.

## Overview

This plugin provides two complementary systems:

1. **Task Continuation**: Automatically continues sessions when incomplete todos remain
2. **Goal Management**: Structured goal tracking with persistence across sessions

**Perfect for:**

- Multi-step task execution with automatic continuation
- Long-running agent workflows with clear objectives
- Goal-oriented AI agents that need to maintain context
- Preventing premature session termination
- Ensuring all tasks in a todo list are completed

## Goal Management Features

The plugin includes a comprehensive goal management system designed for AI agent workflows. Goals provide a higher-level abstraction than todos, representing overarching objectives that guide agent behavior across multiple interactions and sessions.

### Goal Concepts

A **goal** represents a distinct objective that an AI agent should work toward. Unlike todos, which are individual tasks, goals are broader achievements that typically require multiple steps to accomplish. Goals provide:

- **Persistent Context**: Goals persist across sessions, helping agents remember their objectives
- **Clear Completion Criteria**: Each goal has a defined "done condition" that specifies when it's achieved
- **Structured Workflows**: Goals help organize complex multi-step workflows into coherent units
- **Progress Tracking**: Goals track their status (active/completed) and completion timestamps

### Goal Structure

Goals are stored as JSON files with the following structure:

```typescript
interface Goal {
  /** Title of the goal */
  title: string
  /** Optional detailed description of the goal */
  description?: string
  /** String description of what constitutes goal completion */
  done_condition: string
  /** Current status of the goal */
  status: "active" | "completed"
  /** ISO timestamp when the goal was created */
  created_at: string
  /** ISO timestamp when the goal was completed, null if not completed */
  completed_at: string | null
}
```

### Goal Storage

Goals are stored in the following location:

- **Base Path**: `~/.local/share/opencode/plugin/agent-loop`
- **Session Path**: `{basePath}/{sessionID}/goal.json`
- **Custom Path**: Configurable via `goalsBasePath` option

Each session can have **one active goal** at a time. Setting a new goal overwrites the existing one, ensuring agents always have a clear, current objective.

## Installation

```bash
npm install @frugally3683/agent-loop-plugin
```

## Usage

### Basic Usage

```typescript
import agentLoopPlugin from "@frugally3683/agent-loop-plugin"

export default agentLoopPlugin
```

### Goal Management Only

```typescript
import { createGoalManagement } from "@frugally3683/agent-loop-plugin"

export default function myPlugin() {
  const goalManagement = createGoalManagement({})

  return { goalManagement }
}
```

### Task Continuation Only

```typescript
import { createTaskContinuation } from "@frugally3683/agent-loop-plugin"

export default function myPlugin(ctx: PluginContext) {
  const taskContinuation = createTaskContinuation(ctx, {})

  ctx.on("event", taskContinuation.handler)

  return { taskContinuation }
}
```

### Combined Usage

```typescript
import agentLoopPlugin from "@frugally3683/agent-loop-plugin"

export default agentLoopPlugin
```

### Advanced Combined Usage

```typescript
import { createTaskContinuation, createGoalManagement } from "@frugally3683/agent-loop-plugin"

export default function myPlugin(ctx: PluginContext) {
  // Create goal management first (no ctx needed)
  const goalManagement = createGoalManagement({
    goalsBasePath: "/custom/path/to/goals",
  })

  // Create task continuation with goal management integration
  const taskContinuation = createTaskContinuation(ctx, {
    countdownSeconds: 3,
    goalManagement, // Enable goal-aware continuation
  })

  // Register event handlers
  ctx.on("event", goalManagement.handler)
  ctx.on("event", taskContinuation.handler)

  return { goalManagement, taskContinuation }
}
```

## Goal Management API

The goal management system provides the following functions:

### createGoal - Create a New Goal

Creates a new active goal for the session. Overwrites any existing goal.

```typescript
interface GoalManagement {
  createGoal: (
    sessionID: string,
    title: string,
    doneCondition: string,
    description?: string
  ) => Promise<Goal>
}
```

**Parameters:**

- `sessionID`: The session identifier
- `title`: Short, descriptive title for the goal
- `doneCondition`: Description of what constitutes goal completion
- `description` (optional): Detailed explanation of the goal

**Returns:** The created goal object

**Example:**

```typescript
// Set a goal for an agent
const goal = await goalManagement.createGoal(
  sessionID,
  "Implement user authentication",
  "Users can sign up, log in, and log out with secure password handling",
  "Create a complete authentication system with JWT tokens"
)
```

### getGoal - Retrieve Current Goal

Gets the current goal for a session, or null if no goal exists.

```typescript
interface GoalManagement {
  getGoal: (sessionID: string) => Promise<Goal | null>
}
```

**Parameters:**

- `sessionID`: The session identifier

**Returns:** The current goal object, or null if no goal exists

**Example:**

```typescript
// Check current goal
const currentGoal = await goalManagement.getGoal(sessionID)
if (currentGoal) {
  console.log(`Working on: ${currentGoal.title}`)
  console.log(`Done when: ${currentGoal.done_condition}`)
}
```

### completeGoal - Complete a Goal

Marks the current goal as completed and records the completion timestamp.

```typescript
interface GoalManagement {
  completeGoal: (sessionID: string) => Promise<Goal | null>
}
```

**Parameters:**

- `sessionID`: The session identifier

**Returns:** The completed goal object, or null if no goal was active

**Example:**

```typescript
// Mark goal as complete
const completedGoal = await goalManagement.completeGoal(sessionID)
if (completedGoal) {
  console.log(`Goal completed: ${completedGoal.title}`)
  console.log(`Completed at: ${completedGoal.completed_at}`)
}
```

### goal_set and goal_done Commands

The goal management system automatically handles special commands:

**goal_set** - Create a goal via command:

```typescript
// When user sends a command event with:
await ctx.client.session.prompt({
  path: { id: sessionID },
  body: {
    parts: [
      {
        type: "text",
        text: JSON.stringify({
          command: "goal_set",
          args: {
            title: "Implement feature X",
            done_condition: "Feature X is complete and tested",
            description: "Detailed description here",
          },
        }),
      },
    ],
  },
})
```

**goal_done** - Complete a goal via command:

```typescript
// When user sends a command event with:
await ctx.client.session.prompt({
  path: { id: sessionID },
  body: {
    parts: [
      {
        type: "text",
        text: JSON.stringify({
          command: "goal_done",
        }),
      },
    ],
  },
})
```

### Additional Helper Functions

```typescript
interface GoalManagement {
  // Read the current goal for a session
  readGoal: (sessionID: string) => Promise<Goal | null>

  // Write a goal to storage (low-level)
  writeGoal: (sessionID: string, goal: Goal) => Promise<void>

  // Check if session has an active (non-completed) goal
  hasActiveGoal: (sessionID: string) => Promise<boolean>
}
```

**Example - Check for active goal:**

```typescript
const hasActive = await goalManagement.hasActiveGoal(sessionID)
if (!hasActive) {
  // Prompt agent to set a new goal
  console.log("No active goal - what should we work on?")
}
```

### cleanup Method

The goal management system includes a cleanup method for proper resource management:

```typescript
interface GoalManagement {
  cleanup: () => Promise<void>
}
```

**Example:**

```typescript
// Proper cleanup when plugin is unloaded
await goalManagement.cleanup()
```

## Goal Usage in AI Agent Workflows

### Pattern 1: Goal-Directed Task Execution

AI agents can use goals to maintain focus on overarching objectives:

```typescript
// Agent sets a high-level goal at the start of a complex task
await goalManagement.createGoal(
  sessionID,
  "Build REST API for task management",
  "GET, POST, PUT, DELETE endpoints work for tasks with proper error handling",
  "Create a complete REST API with Express.js including validation and authentication"
)

// Agent can query the goal to stay on track
const currentGoal = await goalManagement.getGoal(sessionID)
console.log(`Remember the goal: ${currentGoal.title}`)

// When API is complete, mark goal as done
await goalManagement.completeGoal(sessionID)
```

### Pattern 2: Hierarchical Goal Setting

Agents can break down complex objectives into sub-goals:

```typescript
// Set main project goal
await goalManagement.createGoal(
  sessionID,
  "Complete e-commerce platform",
  "Users can browse products, add to cart, checkout, and receive order confirmation"
)

// When starting a specific feature, update the goal
await goalManagement.createGoal(
  sessionID,
  "Implement shopping cart",
  "Users can add/remove items, view cart contents, and proceed to checkout"
)

// Later, move to next goal
await goalManagement.createGoal(
  sessionID,
  "Implement checkout flow",
  "Users can enter shipping info, payment details, and receive order confirmation"
)
```

### Pattern 3: Goal-Integrated Todo System

Combine goals with todos for comprehensive task management:

```typescript
// Set a goal
const goal = await goalManagement.createGoal(
  sessionID,
  "Deploy application to production",
  "Application is running in production with SSL and accessible via domain"
)

// Create todos that support the goal
await todowrite([
  { id: "1", content: "Set up CI/CD pipeline", status: "pending", priority: "high" },
  { id: "2", content: "Configure production database", status: "pending", priority: "high" },
  { id: "3", content: "Set up SSL certificates", status: "pending", priority: "medium" },
  { id: "4", content: "Update DNS records", status: "pending", priority: "medium" },
  { id: "5", content: "Test production deployment", status: "pending", priority: "high" },
])

// When all todos are complete, mark goal as done
await goalManagement.completeGoal(sessionID)
```

### Pattern 4: Session Persistence

Goals persist across sessions, making them ideal for long-running workflows:

```typescript
// Session 1: Agent sets a complex goal
await goalManagement.createGoal(
  sessionID,
  "Migrate legacy database to new schema",
  "All data migrated, applications updated, old database decommissioned"
)

// Session ends, but goal persists...

// Session 2: Agent checks goal and continues work
const goal = await goalManagement.getGoal(sessionID)
if (goal && goal.status === "active") {
  console.log(`Resuming work on: ${goal.title}`)
  // Continue with migration tasks...
}
```

### Pattern 5: Conditional Goal Completion

Agents can use the done_condition to evaluate progress:

```typescript
const goal = await goalManagement.getGoal(sessionID)
if (goal) {
  // Check if done condition is met
  const progress = assessProgress()

  if (progress.meetsCriteria(goal.done_condition)) {
    await goalManagement.completeGoal(sessionID)
    console.log("Goal completion criteria met!")
  } else {
    console.log(`Still working: ${goal.done_condition}`)
  }
}
```

## Integration with Task Continuation

The goal management system integrates seamlessly with the task continuation system:

1. **Goal-First Planning**: Agents can set goals that guide todo creation
2. **Automatic Continuation**: When sessions become idle with incomplete todos OR active goals, they continue automatically
3. **Goal-Aware Continuations**: Continuation prompts can reference the current goal

```typescript
// Create goal management
const goalManagement = createGoalManagement({})

// Create task continuation with goal integration
const taskContinuation = createTaskContinuation(ctx, {
  goalManagement, // Enable goal-aware continuation
})

// When building continuation prompts, include goal context
function buildGoalAwarePrompt(todos: Todo[], goal: Goal | null): string {
  let prompt = ""

  if (goal) {
    prompt += `[CURRENT GOAL: ${goal.title}]
${goal.done_condition}

`
  }

  prompt += `You have ${incompleteCount} incomplete task(s). Work on them NOW without asking for permission.

PENDING TASKS:
${todos.map((t, i) => `${i + 1}. [${t.status}] ${t.content}`).join("\n")}
`

  return prompt
}
```

## Custom Options

### Goal Management Options

```typescript
import { createGoalManagement } from "@frugally3683/agent-loop-plugin"

const goalManagement = createGoalManagement({
  goalsBasePath: "/custom/path/to/goals", // Custom goal storage location
})
```

### Task Continuation Options

```typescript
import { createTaskContinuation } from "@frugally3683/agent-loop-plugin"

const taskContinuation = createTaskContinuation(ctx, {
  countdownSeconds: 3, // Seconds to wait before continuation (default: 2)
  errorCooldownMs: 5000, // Cooldown after errors (default: 3000)
  toastDurationMs: 900, // Toast notification duration (default: 900)
  agent: "builder", // Agent name for continuations
  model: "claude-3-5-sonnet", // Model name for continuations
  logFilePath: "./plugin.log", // Log file path
  goalManagement, // Goal management instance for goal-aware continuation
})
```

## OpenCode SDK Integration

This plugin uses the OpenCode SDK patterns for session interaction:

```typescript
interface PluginContext {
  /** Working directory for the session */
  directory: string

  /** Client API for interacting with OpenCode */
  client: {
    /** Session management APIs */
    readonly session: {
      /** Get current session ID */
      readonly id: string

      /** Get session details including agent and model */
      get(opts: { path: { id: string } }): Promise<SessionInfo>

      /** List messages in a session, returns most recent first */
      messages(opts: {
        path: { id: string }
      }): Promise<Array<{ info: MessageInfo; parts: unknown[] }>>

      /** Send a prompt to a session */
      prompt(opts: {
        path: { id: string }
        body: {
          agent?: string
          model?: string | ModelSpec
          noReply?: boolean
          parts: Array<PromptPart>
        }
        query?: { directory: string }
      }): Promise<void>

      /** Get todos for a session */
      todo(opts: { path: { id: string } }): Promise<Todo[] | { data: Todo[] }>
    }

    /** Text UI APIs */
    tui: {
      /** Show a toast notification in the UI */
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

### Task Continuation Features

- **Automatic Continuation**: Sessions continue automatically when tasks remain
- **Countdown Timer**: Visual countdown before continuation
- **User Cancellation**: User messages cancel pending continuations
- **Error Handling**: Graceful cooldown periods after errors
- **Completion Detection**: Detects when all tasks are complete
- **Message Filtering**: Correctly handles OpenCode message updates without cancelling countdowns
- **Session Tracking**: Tracks agent/model for consistent continuations
- **Goal-Aware Continuation**: Continues when active goals exist, not just incomplete todos

### Goal Management Features

- **Persistent Goals**: Goals persist across sessions
- **Single Active Goal**: One goal per session prevents confusion
- **Clear Completion Criteria**: Each goal defines when it's done
- **Timestamp Tracking**: Records creation and completion times
- **Storage Persistence**: Goals survive plugin restarts
- **Session Isolation**: Each session has its own goal storage
- **Command Support**: Automatic handling of goal_set and goal_done commands
- **Goal Integration**: Task continuation respects active goals

## Message Handling

OpenCode sends multiple `message.updated` events for the same message. This plugin correctly filters:

- **New User Messages**: Cancel the countdown (genuine user input)
- **Message Updates**: Do NOT cancel the countdown (summary updates, metadata changes)

This prevents message updates from incorrectly interrupting the auto-continuation flow.

## Configuration

### Plugin Options

| Option             | Type    | Default | Description                              |
| ------------------ | ------- | ------- | ---------------------------------------- |
| `taskLoop`         | boolean | true    | Enable task loop functionality           |
| `countdownSeconds` | number  | 2       | Seconds to wait before auto-continuation |
| `errorCooldownMs`  | number  | 3000    | Cooldown period after errors             |
| `toastDurationMs`  | number  | 900     | Toast notification duration              |
| `debug`            | boolean | true    | Enable debug logging                     |
| `logFilePath`      | string  | -       | Path to log file for debugging           |

### Goal Management Options

| Option          | Type   | Default                                   | Description                       |
| --------------- | ------ | ----------------------------------------- | --------------------------------- |
| `goalsBasePath` | string | ~/.local/share/opencode/plugin/agent-loop | Custom base path for goal storage |

### Task Continuation Options

| Option             | Type           | Default | Description                                   |
| ------------------ | -------------- | ------- | --------------------------------------------- |
| `countdownSeconds` | number         | 2       | Seconds to wait before continuation           |
| `errorCooldownMs`  | number         | 3000    | Cooldown period after errors                  |
| `toastDurationMs`  | number         | 900     | Toast notification duration                   |
| `agent`            | string         | -       | Agent name for continuation prompts           |
| `model`            | string         | -       | Model name for continuation prompts           |
| `logFilePath`      | string         | -       | Path to log file for debugging                |
| `goalManagement`   | GoalManagement | -       | Goal management instance for goal integration |

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

## Goal Storage Format

Goals are stored as JSON files in the following structure:

**File Location:** `{goalsBasePath}/{sessionID}/goal.json`

**Example Goal File:**

```json
{
  "title": "Implement user authentication system",
  "description": "Create a complete authentication system with JWT tokens, refresh tokens, and secure password hashing",
  "done_condition": "Users can sign up, log in, and log out with secure password handling and session management",
  "status": "active",
  "created_at": "2024-01-15T10:30:00.000Z",
  "completed_at": null
}
```

**Example Completed Goal:**

```json
{
  "title": "Set up development environment",
  "description": "Configure all necessary tools and dependencies for development",
  "done_condition": "All developers can run 'npm install' and 'npm run dev' successfully",
  "status": "completed",
  "created_at": "2024-01-10T09:00:00.000Z",
  "completed_at": "2024-01-10T11:45:00.000Z"
}
```

## Best Practices

1. **Clear Goal Titles**: Use concise, descriptive titles that fit in a single line
2. **Specific Done Conditions**: Define exactly what "done" means for each goal
3. **Reasonable Scope**: Goals should be achievable within a few hours to days
4. **Update Goals**: When objectives change, update the goal rather than creating new ones
5. **Use with Todos**: Combine goals with todos for comprehensive task management
6. **Complete Goals**: Always call completeGoal when a goal is achieved
7. **Proper Cleanup**: Call cleanup method when plugin is unloaded
8. **Integration**: Enable goal-aware continuation for better agent behavior

## API Reference

### createTaskContinuation

```typescript
function createTaskContinuation(
  ctx: PluginContext,
  options?: TaskContinuationOptions
): TaskContinuation
```

**Parameters:**

- `ctx`: Plugin context with session and tui access
- `options`: Optional configuration for task continuation

**Returns:** TaskContinuation interface with handler, markRecovering, markRecoveryComplete, cancel, and cleanup methods

### createGoalManagement

```typescript
function createGoalManagement(options?: GoalManagementOptions): GoalManagement
```

**Parameters:**

- `options`: Optional configuration for goal management (no ctx needed)

**Returns:** GoalManagement interface with readGoal, writeGoal, createGoal, completeGoal, getGoal, hasActiveGoal, handler, and cleanup methods

## License

MIT
