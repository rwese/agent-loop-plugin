# Migration Guide: Agent Loop Plugin v4.x

This guide helps you migrate from previous versions of the agent-loop-plugin to the new v4.x structure that follows the modern OpenCode plugin patterns.

## What's New in v4.x

### Architecture Changes

**Old Structure:**

```
src/
├── index.ts           # Main entry with all exports
├── types.ts           # Type definitions
├── tools.ts           # Legacy tool definitions
└── [other files]
```

**New Structure:**

```
src/
├── plugin.ts              # Main plugin entry point (NEW)
├── types.ts               # Type definitions
├── logger.ts              # Logging utilities
├── goal/                  # Core goal management (REFACTORED)
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

### Key Changes

1. **Modern Tool Pattern**: Uses `@opencode-ai/plugin` `tool()` decorator for LLM-accessible tools
2. **Separation of Concerns**: Core logic separated from tool definitions
3. **Type Safety**: Full TypeScript support with comprehensive interfaces
4. **Event-Driven**: Uses OpenCode event system for session management
5. **Backward Compatibility**: All existing APIs remain functional

## Migration Steps

### 1. Update Dependencies

**Old:**

```json
{
  "dependencies": {
    "@frugally3683/agent-loop-plugin": "^3.x.x"
  }
}
```

**New:**

```json
{
  "dependencies": {
    "@frugally3683/agent-loop-plugin": "^4.x.x"
  }
}
```

### 2. Update Imports

**Old Import Pattern:**

```typescript
// Direct imports from specific modules
import { createGoalManagement } from "@frugally3683/agent-loop-plugin"
import { createTaskContinuation } from "@frugally3683/agent-loop-plugin"
```

**New Import Pattern:**

```typescript
// Still supported - main exports remain the same
import {
  agentLoopPlugin,
  createGoalManagement,
  createTaskContinuation,
} from "@frugally3683/agent-loop-plugin"
```

### 3. Plugin Integration Changes

**Old Way:**

```typescript
// Manually creating and managing plugin components
import { createGoalManagement } from "@frugally3683/agent-loop-plugin"

export default function myPlugin(ctx) {
  const goalManagement = createGoalManagement(ctx, {})
  const taskContinuation = createTaskContinuation(ctx, {})

  // Manual tool exposure
  return {
    tools: {
      goal_set: (args) => {
        /* implementation */
      },
      goal_status: (args) => {
        /* implementation */
      },
    },
    handlers: [
      /* event handlers */
    ],
  }
}
```

**New Way:**

```typescript
// Plugin handles everything automatically
import agentLoopPlugin from "@frugally3683/agent-loop-plugin"

export default agentLoopPlugin
```

**Advanced Configuration:**

```typescript
import { agentLoopPlugin } from "@frugally3683/agent-loop-plugin"

export default {
  plugins: [agentLoopPlugin],
  // Custom configuration if needed
}
```

### 4. Tool Usage Changes

**Old Way - Manual Command Handling:**

```typescript
// Sending commands via session.prompt
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

**New Way - Direct Tool Calls:**

```typescript
// Tools are automatically available to agents
await goal_set({
  title: "Implement feature X",
  done_condition: "Feature X is complete and tested",
  description: "Detailed description here",
})

// Check goal status
await goal_status()

// Mark goal as complete
await goal_done()

// Cancel goal if needed
await goal_cancel({
  reason: "Requirements changed",
})
```

### 5. Direct API Usage (Unchanged)

The core goal management API remains the same:

```typescript
import { createGoalManagement } from "@frugally3683/agent-loop-plugin"

// Create goal management instance
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

// Check for active goals
const hasActiveGoal = await goalManagement.hasActiveGoal(sessionID)
```

### 6. Task Continuation Integration (Unchanged)

Task continuation with goal awareness works the same way:

```typescript
import { createTaskContinuation } from "@frugally3683/agent-loop-plugin"

const taskContinuation = createTaskContinuation(ctx, {
  countdownSeconds: 3,
  goalManagement, // Enable goal-aware continuation
})
```

## Tool Reference

### Available Tools

All tools are automatically available to OpenCode agents when this plugin is loaded.

#### goal_set

```typescript
goal_set({
  title: string,              // Required: Short goal title
  done_condition: string,     // Required: What "done" looks like
  description?: string        // Optional: Detailed explanation
})
```

#### goal_status

```typescript
goal_status()
// No parameters required
```

#### goal_done

```typescript
goal_done()
// No parameters required
```

#### goal_cancel

```typescript
goal_cancel({
  reason?: string  // Optional: Explanation for cancellation
})
```

## New Tool Development Pattern

If you're building custom tools, here's how to use the new pattern:

```typescript
import { tool } from "@opencode-ai/plugin"

export const myCustomTool = tool({
  description: `My Custom Tool
  
  A detailed description of what this tool does.
  
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

1. **Use Descriptive Names**: Name parameters clearly
2. **Add Descriptions**: Use `.describe()` for parameter context
3. **Validate Types**: Use appropriate schema types
4. **Mark Optional**: Use `.optional()` for non-required params
5. **Provide Defaults**: Use `.default()` when appropriate

## Breaking Changes

### Removed Features

- **Legacy Tool Format**: Old tool definition format is deprecated (but still works)
- **Manual Command Handling**: Direct command processing via `session.prompt` is no longer needed

### Deprecated (Still Work)

- **Direct Import Pattern**: `createGoalManagement` and `createTaskContinuation` exports remain
- **Event Handler Pattern**: Manual event handler setup still supported

## Benefits of Migration

### 1. Better Developer Experience

- Clearer project structure
- Better TypeScript support
- Improved tooling

### 2. Enhanced Agent Capabilities

- Natural language tool calls
- Automatic parameter validation
- Better error handling

### 3. Future-Proof Architecture

- Follows OpenCode patterns
- Easier to extend
- Better maintainability

## Common Migration Issues

### Issue: "Module not found" Errors

**Problem:** TypeScript can't find the plugin module.

**Solution:** Update imports to use the main export:

```typescript
// Instead of deep imports
import { createGoalManagement } from "@frugally3683/agent-loop-plugin/src/goal/management"

// Use main export
import { createGoalManagement } from "@frugally3683/agent-loop-plugin"
```

### Issue: Tool Calls Not Working

**Problem:** Tools aren't available to agents.

**Solution:** Ensure you're using the plugin correctly:

```typescript
// Instead of manual setup
export default function myPlugin() {
  // Complex manual setup...
}

// Use the plugin directly
import agentLoopPlugin from "@frugally3683/agent-loop-plugin"
export default agentLoopPlugin
```

### Issue: Session ID Access

**Problem:** Can't get current session ID.

**Solution:** Use the context provided by the plugin:

```typescript
// Old way
const sessionID = await getSessionID(ctx)

// New way - tools have built-in session access
async function myTool(args, context) {
  const sessionID = context.sessionID
  // ...
}
```

## Rollback Plan

If you encounter issues, you can temporarily roll back:

1. **Pin to previous version:**

   ```json
   {
     "dependencies": {
       "@frugally3683/agent-loop-plugin": "3.x.x"
     }
   }
   ```

2. **Use compatibility layer:**
   ```typescript
   import { createGoalManagement } from "@frugally3683/agent-loop-plugin"
   // Use existing APIs - they remain unchanged
   ```

## Support

If you encounter issues during migration:

1. **Check the examples** in the `/examples` directory
2. **Review the updated documentation** in `README.md`
3. **Report issues** at https://github.com/rwese/agent-loop-plugin/issues

## Timeline

- **v4.0.0**: Initial release with new architecture
- **v4.1.0**: Enhanced tool patterns and documentation
- **v5.0.0**: Planned - Complete migration to new patterns (deprecated features removed)

The migration is designed to be smooth with minimal disruption. Most users can simply update the package version and continue using their existing code.
