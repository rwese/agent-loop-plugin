# Troubleshooting Guide

## Issue: Duplicate Completion Messages

**Symptom:** "All X tasks completed!" shows multiple times

**Cause:** `session.idle` fires multiple times after completion

**Solution (v1.1.4):** Added `completionShown` flag to SessionState

```typescript
if (incompleteCount === 0) {
  if (!state.completionShown) {
    state.completionShown = true
    // Show message once
  }
  return
}
// Reset when tasks exist
state.completionShown = false
```

## Issue: Countdown Shows But Nothing Happens

### In `opencode run`

**Cause:** Process exits before timer fires - this is expected behavior.

**Solution:** Use interactive TUI mode instead:

```bash
opencode  # Interactive mode, process stays alive
```

### In Interactive TUI (Library Timers)

**Cause (pre-v1.2.0):** Library's `setTimeout`/`setInterval` don't fire in plugin environment.

**Solution (v1.2.0+):** Use `onCountdownStart` callback for plugin-side timer management:

```javascript
const taskLoop = createTaskLoop(ctx, {
  onCountdownStart: ({ sessionID, incompleteCount, inject }) => {
    // Plugin handles timer, calls inject() when done
  },
})
```

### In Interactive TUI (Plugin Timers)

**Cause:** Could be multiple issues

**Debug steps:**

1. Enable debug logging:

   ```bash
   AGENT_LOOP_LOG_LEVEL=debug opencode
   ```

2. Look for these log messages:
   - `[startCountdown] Countdown finished` - Timer fired?
   - `[injectContinuation] Called` - Function entered?
   - `[injectContinuation] Skipping` - Why skipped?

3. Check for error cooldown:
   ```
   [injectContinuation] Skipping: recent error (cooldown active)
   ```

## Issue: Multiple Countdowns Starting

**Symptom:** Multiple "Starting countdown" messages for same session

**Cause (pre-v1.1.6):** Plugin loaded multiple times, each with own state Map

**Solution (v1.1.6):** Module-level `globalSessions` Map

**Verification:** With debug logging, you should see:

```
[startCountdown] Starting countdown...
[startCountdown] Countdown already active, skipping
```

## Issue: AI Doesn't Respond to Continuation

**Symptom:** Continuation prompt injected but AI silent

**Cause (pre-v1.1.7):** Status message with `noReply: true` sent after injection

**Solution (v1.1.7):** Removed status message after injection

## Issue: AI Says "Done" Without Completing Tasks

**Symptom:** AI responds to continuation but says "Done: Created X todos" instead of working on them

**Cause (pre-v1.2.1):** Generic continuation prompt didn't give AI specific context

**Solution (v1.2.1):** Improved prompt now includes actual task list:

```
PENDING TASKS:
1. [pending] Create user registration form
2. [in_progress] Add validation to form fields

INSTRUCTIONS:
1. Pick the next pending task and execute it immediately
2. Use todowrite to mark it "in_progress" then "completed" when done
```

## Issue: Error Cooldown Blocking Continuation

**Symptom:** Continuation skipped due to "recent error"

**Cause:** Error occurred within `errorCooldownMs` (default 3000ms)

**Solutions:**

1. Wait for cooldown to expire
2. Send a user message (clears error state)
3. Reduce cooldown:
   ```bash
   AGENT_LOOP_ERROR_COOLDOWN_MS=1000 opencode
   ```

## Issue: Recovery Mode Blocking

**Symptom:** `Skipping: session in recovery mode`

**Cause:** `markRecovering()` was called

**Solution:** Call `markRecoveryComplete()` or restart session

## Issue: Iteration Loop Continues After Task Complete

**Symptom:** Loop keeps iterating even though task is done

**Cause:** Agent didn't call `iteration_loop_complete` tool

**Solution:** Ensure the agent calls the tool:

```json
{
  "name": "iteration_loop_complete",
  "arguments": {
    "summary": "Task completed successfully"
  }
}
```

## Issue: Multiple Iteration Prompts Firing

**Symptom:** Multiple "ITERATION LOOP - ITERATION X/Y" prompts appear simultaneously

**Cause (pre-v1.4.0):** Race condition - multiple `session.idle` events firing before lock set

**Solution (v1.4.0):** Added `iterationInProgress` lock that's set immediately

## Issue: Agent Uses Wrong Completion Method

**Symptom:** Agent outputs `<completion>MARKER</completion>` text instead of calling tool

**Cause:** Agent following old instructions or pattern matching from previous messages

**Solution:**

1. Ensure plugin is updated with `iteration_loop_complete` tool
2. Auto-generated codenames prevent pattern matching
3. Continuation prompt now instructs to use the tool

## Debugging Checklist

1. [ ] Is debug logging enabled? (`AGENT_LOOP_LOG_LEVEL=debug`)
2. [ ] Is the build up to date? (`npm run build`)
3. [ ] Are you in interactive mode? (not `opencode run`)
4. [ ] Check for error cooldown in logs
5. [ ] Check for recovery mode in logs
6. [ ] Verify todos exist and are incomplete
7. [ ] Check if countdown is being cancelled (user message?)
8. [ ] For Iteration Loop: Is `iteration_loop_complete` tool available?

## Log Message Reference

| Message                              | Meaning             | Action                    |
| ------------------------------------ | ------------------- | ------------------------- |
| `Session idle detected`              | AI stopped          | Normal                    |
| `Starting countdown`                 | Timer started       | Wait for it               |
| `Countdown already active, skipping` | Duplicate prevented | Good                      |
| `Countdown finished, injecting`      | Timer fired         | Check injection           |
| `Skipping: recent error`             | Error cooldown      | Wait or send message      |
| `Skipping: session in recovery`      | Manual pause        | Call markRecoveryComplete |
| `Skipping: no incomplete todos`      | All done            | Normal                    |
| `All todos complete`                 | Success             | Done                      |
