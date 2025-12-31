# Development Workflow

## Commands

```bash
npm test          # Run tests (Vitest)
npm run build     # Compile TypeScript to dist/
npm run typecheck # Type check without emit
npm run lint      # ESLint
npm run format    # Prettier
```

## Build Before Testing

Always rebuild before testing with OpenCode:

```bash
npm run build && opencode run "your test prompt"
```

The plugin loads from `dist/index.js`, not the TypeScript source.

## Versioning

**CRITICAL:** Use npm scripts, never edit package.json version manually.

```bash
npm run version:patch  # Bug fixes: 1.0.0 -> 1.0.1
npm run version:minor  # New features: 1.0.0 -> 1.1.0
npm run version:major  # Breaking changes: 1.0.0 -> 2.0.0
```

These scripts automatically:

1. Bump version in package.json
2. Commit with message "chore: bump version to X.Y.Z"
3. Create git tag `vX.Y.Z`

After versioning:

```bash
git push && git push --tags
```

## Code Style

- **ESM modules** - `type: module` in package.json
- **TypeScript strict mode** - All strict checks enabled
- **File extensions** - Use `.js` in imports (e.g., `./types.js`)
- **Prettier** - Formatting enforced via lint-staged (pre-commit hook)

## Plugin Configuration

The plugin is configured in `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["./plugin/agent-loop.js"]
}
```

The plugin file imports from this library:

```javascript
import { createTaskLoop } from "/path/to/agent-loop/dist/index.js"
```

## Debugging Tips

### Enable Debug Logging

```bash
AGENT_LOOP_LOG_LEVEL=debug opencode
```

### Check Plugin Loading

In debug mode, you'll see a toast: "Plugin loaded at [time] (debug mode)"

### Trace State Issues

Add temporary logging to track state:

```typescript
logger.debug("[functionName] State check", {
  sessionID,
  hasTimer: !!state.countdownTimer,
  isStarting: !!state.countdownStarting,
})
```

### Common Debugging Patterns

1. **Multiple instances**: Check if `getState` creates new state for same sessionID
2. **Timer not firing**: Verify process stays alive (not `opencode run`)
3. **AI not responding**: Check if status messages interfere with prompts

## Pre-commit Hook

Husky runs lint-staged on commit, which formats staged files with Prettier.

If commit fails due to formatting:

1. Check the error message
2. Run `npm run format` manually if needed
3. Re-stage and commit
