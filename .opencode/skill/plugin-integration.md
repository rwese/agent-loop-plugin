# Plugin Integration

## Plugin Location

The OpenCode plugin that uses this library is at:

```
~/.config/opencode/plugin/agent-loop.js
```

## Plugin Structure

```javascript
import {
  createTaskLoop,
  createIterationLoop,
  sendIgnoredMessage,
} from "/Users/wese/Repos/OC_agent/agent-loop/dist/index.js"

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
  const taskLoop = createTaskLoop(ctx, {
    countdownSeconds: parseInt(process.env.AGENT_LOOP_COUNTDOWN_SECONDS || "2"),
    errorCooldownMs: parseInt(process.env.AGENT_LOOP_ERROR_COOLDOWN_MS || "3000"),
    logLevel: process.env.AGENT_LOOP_LOG_LEVEL || "warn",
  })

  const iterationLoop = createIterationLoop(ctx, {
    /* ... */
  })

  return {
    // Event handler - both loops process events
    event: async ({ event }) => {
      await Promise.all([taskLoop.handler({ event }), iterationLoop.handler({ event })])
    },

    // Expose controls
    loops: { task: taskLoop, iteration: iterationLoop },
    // ... convenience methods
  }
}

export const main = AgentLoopPlugin
```

## OpenCode Configuration

In `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["./plugin/agent-loop.js"]
}
```

## Environment Variables

Set these before running OpenCode:

```bash
export AGENT_LOOP_LOG_LEVEL=debug
export AGENT_LOOP_COUNTDOWN_SECONDS=2
export AGENT_LOOP_ERROR_COOLDOWN_MS=3000
export AGENT_LOOP_TOAST_DURATION_MS=900
export AGENT_LOOP_MAX_ITERATIONS=50
export AGENT_LOOP_COMPLETION_MARKER=DONE
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

Returns `TaskLoop` with:

- `handler({ event })` - Process OpenCode events
- `markRecovering(sessionID)` - Pause continuation
- `markRecoveryComplete(sessionID)` - Resume continuation
- `cleanup(sessionID)` - Clean up state

### createIterationLoop(ctx, options)

Returns `IterationLoop` with:

- `handler({ event })` - Process OpenCode events
- `startLoop(sessionID, prompt, options)` - Start iteration loop
- `cancelLoop(sessionID)` - Cancel loop
- `getState()` - Get current state

### sendIgnoredMessage(client, sessionID, text)

Send a message visible in UI but NOT added to model context.
Uses `noReply: true` and `ignored: true` flags.
