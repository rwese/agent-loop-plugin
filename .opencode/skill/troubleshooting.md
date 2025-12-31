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

### In Interactive TUI

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

## Debugging Checklist

1. [ ] Is debug logging enabled? (`AGENT_LOOP_LOG_LEVEL=debug`)
2. [ ] Is the build up to date? (`npm run build`)
3. [ ] Are you in interactive mode? (not `opencode run`)
4. [ ] Check for error cooldown in logs
5. [ ] Check for recovery mode in logs
6. [ ] Verify todos exist and are incomplete
7. [ ] Check if countdown is being cancelled (user message?)

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
