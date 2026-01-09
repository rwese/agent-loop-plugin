# Task Continuation & Goal Management Plugin

Minimal task continuation and goal management plugin for OpenCode - automatically continues sessions when incomplete tasks remain and provides structured goal tracking for AI agents using the modern tool pattern.

## Overview

This plugin provides two complementary systems:

1. **Task Continuation**: Automatically continues sessions when incomplete todos remain
2. **Goal Management**: Structured goal tracking with persistence across sessions using the modern OpenCode tool pattern

**Perfect for:**

- Multi-step task execution with automatic continuation
- Long-running agent workflows with clear objectives
- Goal-oriented AI agents that need to maintain context
- Preventing premature session termination
- Ensuring all tasks in a todo list are completed

## New Plugin Architecture

This plugin follows the modern OpenCode plugin architecture with a clean separation of concerns:

```
src/
├── plugin.ts              # Main plugin entry point
├── types.ts               # TypeScript type definitions
├── logger.ts              # Logging utilities
├── goal/                  # Core goal management implementation
│   ├── management.ts      # Goal CRUD operations
│   ├── continuation.ts    # Task continuation logic
│   └── storage.ts         # File-based storage
└── tools/goal/            # OpenCode tool definitions (NEW!)
    ├── index.ts           # Tool factory function
    ├── goal_set.ts        # goal_set tool
    ├── goal_status.ts     # goal_status tool
    ├── goal_done.ts       # goal_done tool
    └── goal_cancel.ts     # goal_cancel tool
```

### Key Architecture Changes

- **Tool Pattern**: Uses `@opencode-ai/plugin` `tool()` decorator for LLM-accessible tools
- **Separation of Concerns**: Core logic (`goal/`) separated from tool definitions (`tools/goal/`)
- **Type Safety**: Full TypeScript support with comprehensive interfaces
- **Event-Driven**: Uses OpenCode event system for session management

## Installation

```bash
npm install @frugally3683/agent-loop-plugin
```

## Quick Start

### Basic Plugin Usage

```typescript
import agentLoopPlugin from "@frugally3683/agent-loop-plugin"

export default agentLoopPlugin
```

### Advanced Usage with Custom Configuration

```typescript
import { agentLoopPlugin } from "@frugally3683/agent-loop-plugin"

export default {
  plugins: [agentLoopPlugin],
  // Custom configuration if needed
}
```

## Tool Reference

The plugin exposes four powerful tools that AI agents can use during conversations to manage goals effectively.

### goal_set

**Purpose**: Set a new goal for the current session to keep the agent focused on primary objectives.

**Usage**:

```typescript
goal_set({
  title: "Implement user authentication",
  done_condition: "Users can sign up, log in, and log out securely",
  description: "Create a complete auth system with JWT tokens",
})
```

**Parameters**:

- `title` (string, required): Short, clear title for the goal
- `done_condition` (string, required): Description of what constitutes goal completion
- `description` (string, optional): Detailed explanation of the goal

**Example Response**:

```
✅ Goal set successfully!

**Title:** Implement user authentication
**Done Condition:** Users can sign up, log in, and log out securely
**Description:** Create a complete auth system with JWT tokens

The agent will work toward this goal. Use goal_done when the condition is met.
```

### goal_status

**Purpose**: Check the current goal status to understand what the agent should be working on.

**Usage**:

```typescript
goal_status()
```

**Parameters**: None required

**Example Response**:

```
🎯 **Current Goal:** Implement user authentication
**Description:** Create a complete auth system with JWT tokens
**Status:** 🟡 In Progress
**Done Condition:** Users can sign up, log in, and log out securely
**Created:** 1/15/2024, 10:30 AM
```

### goal_done

**Purpose**: Mark the current goal as successfully completed when the done condition is met.

**Usage**:

```typescript
goal_done()
```

**Parameters**: None required

**Example Response**:

```
🎉 Goal completed!

**Title:** Implement user authentication
**Completed At:** 1/15/2024, 2:45 PM

The goal has been marked as complete.
```

### goal_cancel

**Purpose**: Cancel or abandon the current goal without completing it when goals are no longer relevant.

**Usage**:

```typescript
goal_cancel({
  reason: "Requirements changed, need to reassess approach",
})
```

**Parameters**:

- `reason` (string, optional): Explanation for why the goal is being cancelled

**Example Response**:

```
🚫 Goal cancelled.

**Title:** Implement user authentication
**Reason:** Requirements changed, need to reassess approach
The goal has been removed.
```

## Goal Management API

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

## Advanced Usage

### Direct Goal Management API

For more control, you can use the goal management API directly:

```typescript
import { createGoalManagement } from "@frugally3683/agent-loop-plugin"

export default function myPlugin() {
  // Create goal management with custom options
  const goalManagement = createGoalManagement({
    goalsBasePath: "/custom/path/to/goals",
  })

  return { goalManagement }
}
```

### Goal Management Functions

#### createGoal

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

**Example**:

```typescript
const goal = await goalManagement.createGoal(
  sessionID,
  "Implement user authentication",
  "Users can sign up, log in, and log out with secure password handling",
  "Create a complete authentication system with JWT tokens"
)
```

#### getGoal

Retrieves the current goal for a session, or null if no goal exists.

```typescript
interface GoalManagement {
  getGoal: (sessionID: string) => Promise<Goal | null>
}
```

**Example**:

```typescript
const currentGoal = await goalManagement.getGoal(sessionID)
if (currentGoal) {
  console.log(`Working on: ${currentGoal.title}`)
  console.log(`Done when: ${currentGoal.done_condition}`)
}
```

#### completeGoal

Marks the current goal as completed and records the completion timestamp.

```typescript
interface GoalManagement {
  completeGoal: (sessionID: string) => Promise<Goal | null>
}
```

**Example**:

```typescript
const completedGoal = await goalManagement.completeGoal(sessionID)
if (completedGoal) {
  console.log(`Goal completed: ${completedGoal.title}`)
  console.log(`Completed at: ${completedGoal.completed_at}`)
}
```

### Task Continuation with Goal Awareness

The task continuation system integrates with goal management for intelligent session continuation:

```typescript
import { createTaskContinuation } from "@frugally3683/agent-loop-plugin"

export default function myPlugin(ctx: PluginContext) {
  const goalManagement = createGoalManagement({})

  const taskContinuation = createTaskContinuation(ctx, {
    countdownSeconds: 3,
    goalManagement, // Enable goal-aware continuation
  })

  return { taskContinuation, goalManagement }
}
```

## Tool Development Patterns

### Using the tool() Decorator

This plugin demonstrates the modern OpenCode tool pattern using the `tool()` decorator from `@opencode-ai/plugin`:

```typescript
import { tool } from "@opencode-ai/plugin"

export const myTool = tool({
  description: `My Custom Tool
  
  A detailed description of what this tool does and when to use it.
  
  **Parameters:**
  - \`param1\`: Description of first parameter
  - \`param2\`: Description of second parameter`,

  args: {
    param1: tool.schema.string().describe("First parameter description"),
    param2: tool.schema.number().describe("Second parameter description"),
    optionalParam: tool.schema.boolean().optional().describe("Optional parameter"),
  },

  async execute(args, context) {
    // Tool implementation
    return `Tool executed with: ${args.param1}, ${args.param2}`
  },
})
```

### Schema Definition Best Practices

1. **Use Descriptive Names**: Name parameters clearly to help LLM agents understand their purpose
2. **Add Descriptions**: Use `.describe()` to provide context for each parameter
3. **Validate Input Types**: Use appropriate schema types (string, number, boolean, etc.)
4. **Mark Optional Parameters**: Use `.optional()` for non-required parameters
5. **Provide Defaults**: Use `.default()` when appropriate for optional parameters

### Tool Context

Tools receive a context object with session information:

```typescript
interface ToolContext {
  sessionID: string // Current session identifier
  messageID: string // Current message identifier
  agent: string // Current agent name
  abort: AbortSignal // Signal for cancellation
}
```

## Integration Patterns

### Pattern 1: Goal-Directed Task Execution

AI agents can use goals to maintain focus on overarching objectives:

```typescript
// Agent sets a high-level goal at the start of a complex task
await goal_set({
  title: "Build REST API for task management",
  done_condition: "GET, POST, PUT, DELETE endpoints work for tasks with proper error handling",
  description: "Create a complete REST API with Express.js including validation and authentication",
})

// Agent can check the goal to stay on track
const goalInfo = await goal_status()
console.log(`Remember the goal: ${goalInfo}`)

// When API is complete, mark goal as done
await goal_done()
```

### Pattern 2: Hierarchical Goal Setting

Agents can break down complex objectives into sub-goals:

```typescript
// Set main project goal
await goal_set({
  title: "Complete e-commerce platform",
  done_condition:
    "Users can browse products, add to cart, checkout, and receive order confirmation",
})

// When starting a specific feature, update the goal
await goal_set({
  title: "Implement shopping cart",
  done_condition: "Users can add/remove items, view cart contents, and proceed to checkout",
})

// Later, move to next goal
await goal_set({
  title: "Implement checkout flow",
  done_condition: "Users can enter shipping info, payment details, and receive order confirmation",
})
```

### Pattern 3: Goal-Integrated Todo System

Combine goals with todos for comprehensive task management:

```typescript
// Set a goal
await goal_set({
  title: "Deploy application to production",
  done_condition: "Application is running in production with SSL and accessible via domain",
})

// Create todos that support the goal
await todowrite([
  { id: "1", content: "Set up CI/CD pipeline", status: "pending", priority: "high" },
  { id: "2", content: "Configure production database", status: "pending", priority: "high" },
  { id: "3", content: "Set up SSL certificates", status: "pending", priority: "medium" },
  { id: "4", content: "Update DNS records", status: "pending", priority: "medium" },
  { id: "5", content: "Test production deployment", status: "pending", priority: "high" },
])

// When all todos are complete, mark goal as done
await goal_done()
```

### Pattern 4: Session Persistence

Goals persist across sessions, making them ideal for long-running workflows:

```typescript
// Session 1: Agent sets a complex goal
await goal_set({
  title: "Migrate legacy database to new schema",
  done_condition: "All data migrated, applications updated, old database decommissioned",
})

// Session ends, but goal persists...

// Session 2: Agent checks goal and continues work
const goalInfo = await goal_status()
if (goalInfo.includes("Migrate legacy database")) {
  console.log("Resuming work on database migration...")
  // Continue with migration tasks...
}
```

### Pattern 5: Conditional Goal Completion

Agents can use the done_condition to evaluate progress:

```typescript
const goalInfo = await goal_status()
if (goalInfo.includes("🟡 In Progress")) {
  // Check if done condition is met
  const progress = assessProgress()

  if (progress.meetsCriteria()) {
    await goal_done()
    console.log("Goal completion criteria met!")
  } else {
    console.log("Still working toward goal completion...")
  }
}
```

## Configuration Options

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
6. **Complete Goals**: Always call goal_done when a goal is achieved
7. **Cancel When Needed**: Use goal_cancel when goals are no longer relevant
8. **Leverage Tools**: Use the goal tools during conversations for better agent coordination

## API Reference

### agentLoopPlugin

```typescript
const agentLoopPlugin: Plugin = async (ctx: PluginContext): Promise<PluginResult>
```

**Parameters:**

- `ctx`: Plugin context with session and tui access

**Returns:** PluginResult with tools and event handlers

**Tools Provided:**

- `goal_set`: Set a new goal for the session
- `goal_status`: Check current goal status
- `goal_done`: Mark current goal as completed
- `goal_cancel`: Cancel current goal

### createGoalManagement

```typescript
function createGoalManagement(options?: GoalManagementOptions): GoalManagement
```

**Parameters:**

- `options`: Optional configuration for goal management

**Returns:** GoalManagement interface with readGoal, writeGoal, createGoal, completeGoal, getGoal, hasActiveGoal, handler, and cleanup methods

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

## Migration Guide

### From Previous Versions

If you're migrating from an older version of this plugin:

1. **Import Changes**: Update imports to use the new structure

   ```typescript
   // Old way
   import { createGoalManagement } from "@frugally3683/agent-loop-plugin"

   // New way (still supported)
   import { createGoalManagement } from "@frugally3683/agent-loop-plugin"
   ```

2. **Tool Usage**: Tools are now automatically exposed to agents

   ```typescript
   // Old way - manual command handling
   .prompt({
   await ctx.client.session     path: { id: sessionID },
     body: {
       parts: [{
         type: "text",
         text: JSON.stringify({
           command: "goal_set",
           args: { title: "...", done_condition: "..." }
         })
       }]
     }
   })

   // New way - direct tool calls
   await goal_set({
     title: "...",
     done_condition: "...",
     description: "..."
   })
   ```

3. **Plugin Integration**: The plugin now automatically handles tool exposure

   ```typescript
   // Just import and use the plugin
   import agentLoopPlugin from "@frugally3683/agent-loop-plugin"

   export default agentLoopPlugin
   ```

### New Tool Pattern Benefits

- **Natural Language Interface**: Agents can call tools using natural language
- **Automatic Schema Validation**: Input validation built into the tool pattern
- **Better Error Handling**: Consistent error responses across all tools
- **Context Awareness**: Tools have access to session context automatically
- **Type Safety**: Full TypeScript support for tool definitions

## License

MIT
