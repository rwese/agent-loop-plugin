# Migration Guide: Agent Loop Plugin v5.x

This guide helps you migrate from previous versions of the agent-loop-plugin to the new v5.x structure that focuses on task continuation only.

## What's New in v5.x

### Goal Management Removed

v5.x removes goal management functionality to focus on core task continuation:

- **Removed**: Goal management tools (`goal_set`, `goal_status`, `goal_done`, `goal_cancel`, `goal_validate`)
- **Removed**: Goal persistence and storage
- **Removed**: Goal context injection
- **Kept**: Task continuation with todo-based auto-continuation

### Architecture Changes

**Old Structure:**

```
src/
├── plugin.ts              # Main plugin entry point
├── types.ts               # Type definitions (including Goal types)
├── goal/                  # Core goal management (REMOVED)
│   ├── management.ts      # Goal CRUD operations
│   ├── continuation.ts    # Task continuation logic
│   └── storage.ts         # File-based storage
└── tools/goal/            # OpenCode tool definitions (REMOVED)
    ├── index.ts           # Tool factory function
    ├── goal_set.ts        # goal_set tool
    └── ...
```

**New Structure:**

```
src/
├── plugin.ts              # Main plugin entry point
├── types.ts               # Type definitions (Goal types removed)
├── logger.ts              # Logging utilities
└── session-context.ts     # Session context utilities
```

## Migration Steps

### 1. Update Dependencies

**Old:**

```json
{
  "dependencies": {
    "@frugally3683/agent-loop-plugin": "^4.x.x"
  }
}
```

**New:**

```json
{
  "dependencies": {
    "@frugally3683/agent-loop-plugin": "^5.x.x"
  }
}
```

### 2. Remove Goal Tool Usage

**Old - Using Goal Tools:**

```typescript
// Goal tools are no longer available
await goal_set({
  title: "Implement feature X",
  done_condition: "Feature X is complete and tested",
})

await goal_status()
await goal_done()
await goal_cancel({ reason: "Changed priorities" })
await goal_validate()
```

**New - Use Todo Management:**

```typescript
// Use todo tools for task management instead
await todowrite({
  todos: [
    {
      id: "1",
      content: "Implement feature X",
      status: "in_progress",
      priority: "high",
    },
  ],
})

// Check todo status
await todoread()

// Update todo status
await todowrite({
  todos: [
    {
      id: "1",
      content: "Implement feature X",
      status: "completed",
      priority: "high",
    },
  ],
})
```

### 3. Remove Goal Management API Usage

**Old - Direct Goal Management API:**

```typescript
import { createGoalManagement } from "@frugally3683/agent-loop-plugin"

const goalManagement = createGoalManagement({
  goalsBasePath: "/custom/path/to/goals",
})

// Create goals
await goalManagement.createGoal(
  sessionID,
  "Implement user authentication",
  "Users can sign up, log in, and log out securely",
  "Create auth system with JWT tokens"
)

// Get current goal
const goal = await goalManagement.getGoal(sessionID)

// Complete goal
await goalManagement.completeGoal(sessionID)
```

**New - Task Continuation Only:**

```typescript
import { createTaskContinuation } from "@frugally3683/agent-loop-plugin"

const taskContinuation = createTaskContinuation(ctx, {
  countdownSeconds: 2,
  errorCooldownMs: 3000,
  toastDurationMs: 900,
})

// Task continuation automatically handles:
// - Session idle detection
// - Todo-based auto-continuation
// - User message handling
```

### 4. Update Plugin Configuration

**Old Configuration with Goals:**

```json
{
  "debug": true,
  "countdownSeconds": 2,
  "goalsBasePath": "~/.local/share/opencode/goals"
}
```

**New Configuration:**

```json
{
  "debug": true,
  "countdownSeconds": 2,
  "errorCooldownMs": 3000,
  "toastDurationMs": 900,
  "logFilePath": "~/.local/share/opencode/agent-loop.log"
}
```

### 5. Update Import Statements

**Old Imports:**

```typescript
import {
  agentLoopPlugin,
  createGoalManagement,
  createTaskContinuation,
} from "@frugally3683/agent-loop-plugin"

// Goal types
import type { Goal, GoalManagement } from "@frugally3683/agent-loop-plugin"
```

**New Imports:**

```typescript
import { agentLoopPlugin, createTaskContinuation } from "@frugally3683/agent-loop-plugin"

// Goal types are no longer available
```

## Breaking Changes

### Removed Features

- **Goal Management Tools**: `goal_set`, `goal_status`, `goal_done`, `goal_cancel`, `goal_validate`
- **Goal Management API**: `createGoalManagement` export
- **Goal Types**: `Goal`, `GoalManagement`, `GoalManagementOptions`, `GOALS_BASE_PATH`, `GOAL_FILENAME`
- **Goal Storage**: File-based goal persistence at `~/.local/share/opencode/plugin/agent-loop/`
- **Goal Context Injection**: Automatic goal context in session prompts

### Removed Configuration Options

- `goalsBasePath`: Goal storage path (no longer applicable)

### Updated APIs

**createTaskContinuation:**

```typescript
// Old signature
createTaskContinuation(input, options, goalManagement?: GoalManagement)

// New signature
createTaskContinuation(input, options)
```

The `goalManagement` parameter has been removed.

## Benefits of Migration

### 1. Simplified Architecture

- Cleaner codebase without goal management complexity
- Focus on core task continuation functionality
- Easier to maintain and extend

### 2. Reduced Dependencies

- No file system operations for goal storage
- Simpler configuration management
- Smaller bundle size

### 3. Clearer Purpose

- Plugin focused on task continuation only
- Better alignment with user expectations
- Easier to understand and use

## Common Migration Issues

### Issue: "Module not found" Errors

**Problem:** Can't find goal-related imports.

**Solution:** Remove goal-related imports:

```typescript
// Remove these imports
import { createGoalManagement } from "@frugally3683/agent-loop-plugin"
import type { Goal } from "@frugally3683/agent-loop-plugin"
```

### Issue: Goal Tools Not Working

**Problem:** Goal tools are no longer available to agents.

**Solution:** Use todo management tools instead:

```typescript
// Instead of goal tools
await todowrite({ todos: [...] })
await todoread()
```

### Issue: Session Continuation Not Working

**Problem:** Task continuation behavior changed.

**Solution:** Ensure you're using todo-based continuation:

```typescript
// Create tasks with todos for continuation to work
await todowrite({
  todos: [
    {
      id: "1",
      content: "Complete this task",
      status: "in_progress",
      priority: "high",
    },
  ],
})
```

## Rollback Plan

If you encounter issues, you can temporarily roll back:

1. **Pin to previous version:**

   ```json
   {
     "dependencies": {
       "@frugally3683/agent-loop-plugin": "4.x.x"
     }
   }
   ```

2. **Note**: Goal management functionality is only available in v4.x and earlier.

## Support

If you encounter issues during migration:

1. **Review the updated documentation** in `README.md`
2. **Check the examples** in the repository
3. **Report issues** at https://github.com/rwese/agent-loop-plugin/issues

## Timeline

- **v5.0.0**: Initial release with goal management removed
- Future versions will focus on enhancing task continuation

The migration is designed to be straightforward - simply remove goal-related code and rely on todo-based task continuation.
