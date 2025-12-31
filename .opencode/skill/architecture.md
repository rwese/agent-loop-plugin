# Agent Loop Architecture

## Overview

TypeScript library providing agent loop mechanisms for OpenCode plugins. Two main components:

1. **Task Loop** - Auto-continues sessions when incomplete todos remain
2. **Iteration Loop** - Iteration-based loop with completion marker detection

## File Structure

```
index.ts          # Public API exports
types.ts          # Shared type definitions
task-loop.ts      # Task Loop implementation
iteration-loop.ts # Iteration Loop implementation
utils.ts          # Shared utilities (logging, state management)
__tests__/        # Test files
  mocks.ts        # OpenCode context mocking
```

## Task Loop Flow

```
session.idle event
       |
       v
  Check todos via API
       |
       v
  Incomplete? ──No──> Show completion message (once)
       |
      Yes
       |
       v
  Start countdown (skip if already active)
       |
       v
  [2 seconds pass]
       |
       v
  Inject continuation prompt
       |
       v
  AI responds, works on tasks
       |
       v
  [cycle repeats]
```

## Key Design Decisions

### Module-Level State (v1.1.6)

**Problem:** Plugin loaded multiple times created separate `sessions` Maps, causing duplicate countdowns.

**Solution:** Use module-level `globalSessions` Map shared across all TaskLoop instances.

```typescript
// Module level - shared across instances
const globalSessions = new Map<string, SessionState>()

export function createTaskLoop(ctx, options) {
  const sessions = globalSessions // Reference to shared map
  // ...
}
```

### Race Condition Prevention

**Problem:** Multiple `session.idle` events fire simultaneously, starting multiple countdowns.

**Solution:** `countdownStarting` flag set synchronously before any async operations.

```typescript
if (state.countdownTimer || state.countdownStarting) {
  return // Skip if countdown active or starting
}
state.countdownStarting = true // Set immediately
```

### No Status Message After Injection (v1.1.7)

**Problem:** Sending `noReply: true` message after continuation prompt interfered with AI response.

**Solution:** Removed the status message call after successful injection.

## State Management

### SessionState Interface

```typescript
interface SessionState {
  lastErrorAt?: number // For error cooldown
  countdownTimer?: Timeout // Main countdown timer
  countdownInterval?: Interval // Toast update interval
  isRecovering?: boolean // Manual pause flag
  completionShown?: boolean // Prevent duplicate messages
  countdownStarting?: boolean // Race condition guard
  _id?: number // Debug tracking
}
```

### State Lifecycle

1. **Created**: On first `session.idle` for a session
2. **Updated**: During countdown, on errors, on recovery
3. **Cleaned**: On `session.deleted` event
4. **Persisted**: In memory only (Map), not to disk

## Event Handling

| Event                    | Task Loop Action                    |
| ------------------------ | ----------------------------------- |
| `session.idle`           | Check todos, start countdown        |
| `session.error`          | Record error time, cancel countdown |
| `message.updated` (user) | Cancel countdown, clear error       |
| `session.deleted`        | Cleanup session state               |

## API Surface

```typescript
// Factory function
createTaskLoop(ctx: PluginContext, options?: TaskLoopOptions): TaskLoop

// TaskLoop interface
interface TaskLoop {
  handler: (input: { event: LoopEvent }) => Promise<void>
  markRecovering: (sessionID: string) => void
  markRecoveryComplete: (sessionID: string) => void
  cleanup: (sessionID: string) => void
}
```
