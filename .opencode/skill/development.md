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

## CI/CD & Publishing Issues

### Issue: npm ENEEDAUTH - "This command requires you to be logged in to https://registry.npmjs.org/"

**Symptom:** Build fails during publish step with:

```
npm error need auth This command requires you to be logged to https://registry.npmjs.org/
npm error need auth You need to authorize this machine using `npm adduser`
```

**Cause:** npm is trying to publish to the default registry instead of Codeberg.

**Solution:** Add `publishConfig` to `package.json`:

```json
{
  "publishConfig": {
    "registry": "https://codeberg.org/api/packages/npm"
  }
}
```

This ensures npm publishes to the correct registry regardless of `.npmrc` configuration order.

### Issue: "git command not found" in CI

**Symptom:** Woodpecker CI fails with:

```
/bin/sh: exec format line 1: git not found
```

**Cause:** Alpine-based Docker images (`node:22-alpine`) don't include git by default.

**Solution:** Install git in each CI step:

```yaml
steps:
  install:
    image: node:22-alpine
    commands:
      - apk add --no-cache git
      - npm ci
```

Add this to all steps that might need git (including publish step for tagging).

### Issue: Tag Already Exists When Repushing

**Symptom:** Failed to push tag:

```
fatal: tag 'v3.1.4' already exists
```

**Solution:** Delete remote tag and push again:

```bash
git push origin :refs/tags/v3.1.4
git push && git push --tags
```

### Issue: .npmrc Not Working in CI

**Symptom:** Registry configuration in `.npmrc` is being ignored.

**Solution:** Create `.npmrc` inline in CI step before publishing:

```yaml
commands:
  - |
    echo "@nope-at:registry=https://codeberg.org/api/packages/npm" > .npmrc
    echo "//codeberg.org/api/packages/npm/:_authToken=$CODEBERG_TOKEN" >> .npmrc
  - npm publish --access public
```

This ensures the file exists with correct permissions in CI environment.

### CI/CD Checklist

1. [ ] Alpine images have `apk add --no-cache git` for git-dependent commands
2. [ ] `publishConfig.registry` set in `package.json` for correct registry
3. [ ] `.npmrc` created inline in publish step with auth token
4. [ ] Woodpecker secrets configured (e.g., `CODEBERG_TOKEN`)
5. [ ] Tag pushed after version bump (`git push --tags`)
