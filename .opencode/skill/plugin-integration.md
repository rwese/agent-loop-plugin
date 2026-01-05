# Plugin Integration

## Plugin Location

The OpenCode plugin that uses this library is at:

```
~/.config/opencode/plugin/index.js
```

## Plugin Structure

```javascript
import { createTaskLoop, createIterationLoop, sendIgnoredMessage } from "agent-loop-plugin"

export const AgentLoopPlugin = async ({ directory, client }) => {
  // Create plugin context
  const ctx = {
    directory,
    client: {
      session: {
        prompt: async (opts) => client.session.prompt(opts),
        todo: async (opts) => client.session.todo(opts),
      },
      tui: {
        showToast: async (opts) => client.tui.showToast(opts),
      },
    },
  }

  // Create loops with config from environment
  // IMPORTANT: Use onCountdownStart callback - library timers don't work in plugin env
  const taskLoop = createTaskLoop(ctx, {
    countdownSeconds: parseInt(process.env.AGENT_LOOP_COUNTDOWN_SECONDS || "5"),
    errorCooldownMs: parseInt(process.env.AGENT_LOOP_ERROR_COOLDOWN_MS || "3000"),
    logLevel: process.env.AGENT_LOOP_LOG_LEVEL || "info",
    helpAgent: process.env.AGENT_LOOP_HELP_AGENT,
    onCountdownStart: ({ sessionID, incompleteCount, inject }) => {
      // Plugin handles timer - library timers don't fire in plugin environment
      let aborted = false
      const countdown = async () => {
        for (let i = 5; i > 0 && !aborted; i--) {
          ctx.client.tui.showToast({
            body: {
              title: "Task Continuation",
              message: `Resuming in ${i}s...`,
              variant: "warning",
              duration: 900,
            },
          })
          await new Promise((r) => setTimeout(r, 1000))
        }
        if (!aborted) await inject()
      }
      countdown()
      return {
        abort: () => {
          aborted = true
        },
      }
    },
  })

  const iterationLoop = createIterationLoop(ctx, {
    /* ... */
  })

  return {
    event: async ({ event }) => {
      // Cancel countdown on certain events (user message, assistant response, etc.)
      // ... event handling logic
      await Promise.all([taskLoop.handler({ event }), iterationLoop.handler({ event })])
    },
    loops: { task: taskLoop, iteration: iterationLoop },
  }
}

export const main = AgentLoopPlugin
```

## OpenCode Configuration

In `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["./plugin/index.js"]
}
```

## Environment Variables

Set these before running OpenCode:

```bash
export AGENT_LOOP_LOG_LEVEL=debug           # silent|error|warn|info|debug
export AGENT_LOOP_COUNTDOWN_SECONDS=5       # Countdown before auto-continue
export AGENT_LOOP_ERROR_COOLDOWN_MS=3000    # Pause after errors
export AGENT_LOOP_TOAST_DURATION_MS=900     # Toast display duration
export AGENT_LOOP_MAX_ITERATIONS=50         # Max iterations for iteration loop
export AGENT_LOOP_HELP_AGENT=advisor        # Subagent for AI to ask questions (optional)
```

Note: Completion markers are auto-generated as unique codenames (e.g., "CRIMSON_FALCON").

### Help Agent

When `AGENT_LOOP_HELP_AGENT` is set, the continuation prompt includes instructions for the AI to use the Task tool with that subagent when it needs help or clarification:

```
IF YOU NEED HELP:
- Use the Task tool with subagent_type="advisor" to ask questions or get feedback
- Example: Task(prompt="I need clarification on...", subagent_type="advisor")
- Only use this if you are truly blocked - prefer making progress independently
```

## Event Flow

```
OpenCode Event System
        |
        v
  Plugin event handler
        |
        v
  Promise.all([
    taskLoop.handler({ event }),
    iterationLoop.handler({ event })
  ])
        |
        v
  Each loop processes independently
```

## Important: Plugin-Side Timers (v1.2.0+)

Library's internal `setTimeout`/`setInterval` don't work in the OpenCode plugin environment - the timers never fire.

**Solution:** Use `onCountdownStart` callback to let the plugin handle timer management:

```javascript
const taskLoop = createTaskLoop(ctx, {
  onCountdownStart: ({ sessionID, incompleteCount, totalCount, inject }) => {
    // Plugin manages the countdown timer
    // Call inject() when countdown completes
  },
})
```

When `onCountdownStart` is provided, the library does NOT handle timers - the plugin must call `inject()` after the countdown.

## Important: Multiple Plugin Loads

OpenCode may load the plugin multiple times. This caused issues before v1.1.6.

**Problem:** Each load created new `sessions` Map, breaking state sharing.

**Solution:** Module-level `globalSessions` Map in the library ensures all instances share state.

## Updating the Library

After making changes:

```bash
# 1. Build the library
npm run build

# 2. Test with OpenCode
opencode  # or: opencode run "test prompt"
```

The plugin imports from `dist/index.js`, so always rebuild after changes.

## API Used by Plugin

### createTaskLoop(ctx, options)

**Options:**

- `countdownSeconds` - Countdown duration (default: 2)
- `errorCooldownMs` - Pause after errors (default: 3000)
- `toastDurationMs` - Toast display duration (default: 900)
- `logLevel` - Log level (default: "info")
- `helpAgent` - Subagent name for AI help/feedback (optional)
- `onCountdownStart` - Callback for plugin-side timer management (recommended)

Returns `TaskLoop` with:

- `handler({ event })` - Process OpenCode events
- `markRecovering(sessionID)` - Pause continuation
- `markRecoveryComplete(sessionID)` - Resume continuation
- `cleanup(sessionID)` - Clean up state

### createIterationLoop(ctx, options)

Returns `IterationLoop` with:

- `handler({ event })` - Process OpenCode events
- `startLoop(sessionID, prompt, options)` - Start iteration loop (codename auto-generated)
- `completeLoop(sessionID, summary?)` - Complete the loop (preferred way to stop)
- `cancelLoop(sessionID)` - Cancel loop (abandon task)
- `getState()` - Get current state

### sendIgnoredMessage(client, sessionID, text)

Send a message visible in UI but NOT added to model context.
Uses `noReply: true` and `ignored: true` flags.
