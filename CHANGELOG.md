# Changelog

## [6.0.0] - 2026-01-20

### Breaking Changes

**Goal Management Feature Removed**

This major release removes the goal management feature to simplify the plugin and focus on task continuation functionality.

#### Removed Features

- **Goal Management Tools**: `goal_set`, `goal_status`, `goal_done`, `goal_cancel`, `goal_validate`
- **Goal Management API**: `createGoalManagement` export
- **Goal Types**: `Goal`, `GoalManagement`, `GoalManagementOptions`, `GOALS_BASE_PATH`, `GOAL_FILENAME`
- **Goal Storage**: File-based goal persistence at `~/.local/share/opencode/plugin/agent-loop/`
- **Goal Context Injection**: Automatic goal context in session prompts

#### Removed Files

- `src/tools/goal/` - Goal tool implementations
- `packages/goals/` - Goal management package
- `src/goal-context-injection.ts` - Goal context injection
- `src/goal/` - Goal management implementation (management.ts, storage.ts, continuation.ts)
- `tools.ts` - Goal tools definitions
- `GOAL_IMPLEMENTATION.md` - Goal implementation documentation
- Goal-related test files in `__tests__/`

#### Updated APIs

**createTaskContinuation:**

```typescript
// Old signature (with goal management)
createTaskContinuation(input, options, goalManagement?: GoalManagement)

// New signature (task continuation only)
createTaskContinuation(input, options)
```

**Plugin Configuration:**

Goal-related configuration options have been removed. The plugin now focuses solely on task continuation based on todo items.

#### Migration Guide

Users should migrate from goal-based workflows to todo-based workflows:

**Before (Goal-based):**

```typescript
await goal_set({
  title: "Implement feature X",
  done_condition: "Feature X is complete and tested",
  description: "Detailed description here",
})
await goal_done()
await goal_validate()
```

**After (Todo-based):**

```typescript
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
// ... work on task ...
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

#### Benefits

- Simplified plugin architecture
- Reduced bundle size
- Clearer focus on task continuation
- No file system operations for goal storage
- Easier to maintain and extend

## [5.1.2] - 2026-01-14

### Fixed

- Goal validation prompt issues causing JSON parse errors and stuck state
- Agents now properly understand that goal_validate() is available after goal_done()
- Removed problematic prompt injection during tool execution that caused conflicts

### Changed

- Enhanced goal_done() response with clear messaging about goal_validate() availability
- Improved goal_validate tool description for better agent understanding
- Better error handling in goal validation workflow

### Code Quality

- Removed unused imports (getContext, sessionContext)
- Fixed linting errors in packages/goals/index.ts and src/plugin.ts

## [5.1.0] - 2026-01-14

### Added

- JSONC configuration file support (`.jsonc` files with comments)
- Modular plugin architecture with separate packages:
  - `@agent-loop/tools` - Shared utilities (types, logger, session context)
  - `agent-loop-goals` - Goal management plugin
  - `agent-loop-continuation` - Task continuation plugin
- Configuration file support at `~/.local/share/opencode/agent-loop-plugin.jsonc`
- Example configuration file (`example-config.agent-loop-plugin.jsonc`)
- Comprehensive configuration documentation (`CONFIGURATION.md`)

### Changed

- Completely removed all console logging output (debug, info, warn, error)
- Plugin is now silent by default, no initialization messages
- Bundle size reduced by ~7.6 KB (from 497.1 KB to 489.5 KB)
- Refactored for cleaner architecture and better separation of concerns
- Removed debug logging from source files

### Fixed

- Config file not found errors no longer logged as warnings
- Proper handling of missing config files with silent fallback

### Removed

- All debug logging statements
- Console output during plugin initialization
- Logger imports and initialization from main plugin

## [5.0.1] - Previous

- Initial release with task continuation and goal management
