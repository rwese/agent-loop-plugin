# Testing the Agent Loop

## Unit Tests

Run the test suite:

```bash
npm test              # Run all tests
npm run test:coverage # Run with coverage
```

Tests are in `__tests__/` directory using Vitest.

## Manual Testing with OpenCode

### Interactive TUI (Recommended)

The task loop is designed for interactive sessions where the process stays alive:

```bash
opencode
# Then in the TUI: "create 4 todos and stop"
# Watch the countdown toast and continuation
```

### One-Shot Commands (Limited)

`opencode run` exits immediately after AI responds - timers won't fire:

```bash
# This will show countdown starting but process exits before timer fires
AGENT_LOOP_LOG_LEVEL=debug opencode run "create 3 todos and stop"
```

**Why it doesn't work:** `opencode run` is for one-shot operations. The Node.js process exits before `setTimeout` callbacks can execute.

## Debug Logging

Enable debug logging to see internal state:

```bash
AGENT_LOOP_LOG_LEVEL=debug opencode
```

Key log messages to watch for:

| Log Message                                                   | Meaning                       |
| ------------------------------------------------------------- | ----------------------------- |
| `[session.idle] Session idle detected`                        | AI stopped responding         |
| `[startCountdown] Starting countdown...`                      | Countdown timer started       |
| `[startCountdown] Countdown already active, skipping`         | Duplicate event ignored       |
| `[startCountdown] Countdown finished, injecting continuation` | Timer fired                   |
| `[injectContinuation] Called`                                 | Continuation function entered |
| `Injecting continuation prompt`                               | Prompt being sent to AI       |
| `Continuation prompt injected successfully`                   | Prompt sent                   |
| `[session.idle] All todos complete`                           | All tasks done                |

## Environment Variables

| Variable                       | Default | Description                                 |
| ------------------------------ | ------- | ------------------------------------------- |
| `AGENT_LOOP_LOG_LEVEL`         | `info`  | Log level: silent, error, warn, info, debug |
| `AGENT_LOOP_COUNTDOWN_SECONDS` | `5`     | Seconds before auto-continue                |
| `AGENT_LOOP_ERROR_COOLDOWN_MS` | `3000`  | Pause after errors                          |
| `AGENT_LOOP_TOAST_DURATION_MS` | `900`   | Toast display duration                      |
| `AGENT_LOOP_HELP_AGENT`        | -       | Subagent name for AI help (e.g., "advisor") |

## Common Issues

### Countdown shows but nothing happens

1. **In `opencode run`**: Expected - process exits before timer fires
2. **In TUI with library timers**: Library timers don't work in plugin env - use `onCountdownStart` callback (v1.2.0+)
3. **Multiple instances**: Fixed in v1.1.6 with module-level state

### Duplicate completion messages

Fixed in v1.1.4 with `completionShown` flag.

### AI doesn't respond to continuation

Fixed in v1.1.7 by removing status message after injection that was interfering with AI response.

### AI says "Done" without completing tasks

Fixed in v1.2.1 with improved continuation prompt that includes the actual task list, not just a generic "continue working" message.
