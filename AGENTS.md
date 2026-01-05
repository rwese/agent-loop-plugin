# Agent Instructions

## Project Overview

TypeScript library providing agent loop mechanisms for OpenCode plugins. Extracted from [oh-my-opencode](https://github.com/open-code-ai/oh-my-opencode).

**Two main components:**

1. **Task Loop** - Automatically continues sessions when incomplete todos remain
2. **Iteration Loop** - Continues iteration until `iteration_loop_complete` tool is called

## Code Style

- **ESM modules** - `type: module` in package.json
- **TypeScript strict mode** - All strict checks enabled
- **File extensions** - Use `.js` in imports (e.g., `./types.js`)
- **Prettier** - Formatting enforced via lint-staged
- **ESLint** - TypeScript-aware linting

## Architecture

```
index.ts          # Public API exports
types.ts          # Shared type definitions
task-loop.ts      # Task Loop implementation
iteration-loop.ts # Iteration Loop implementation
utils.ts          # Shared utilities (logging, state management)
```

### Key Patterns

- **Factory functions** - `createTaskLoop()`, `createIterationLoop()`
- **Event-driven** - Handlers respond to `session.idle`, `session.error`, etc.
- **Dependency injection** - `PluginContext` is passed to factory functions
- **File-based state** - Iteration Loop persists state to `.agent-loop/`

## Development

### Commands

```bash
npm test          # Run tests (Vitest)
npm run build     # Compile TypeScript
npm run typecheck # Type check without emit
npm run lint      # ESLint
npm run format    # Prettier
```

### Testing

- Tests in `__tests__/` directory
- Use `__tests__/mocks.ts` for OpenCode context mocking
- Vitest with coverage via `npm run test:coverage`

### Pre-commit

Husky runs `lint-staged` which formats staged files with Prettier.

## Important Notes

- **No external runtime dependencies** - Only Node.js built-ins (fs, path)
- **Minimal API surface** - Export only what's needed
- **Type-safe** - Full TypeScript types for all public APIs
- **Node 18+** required

## Versioning

**CRITICAL FOR AI AGENTS:** You MUST use the npm version scripts below. Do NOT manually edit package.json version or create git tags directly.

Use npm scripts for semver versioning:

```bash
npm run version:patch  # 1.0.0 -> 1.0.1 (bug fixes)
npm run version:minor  # 1.0.0 -> 1.1.0 (new features, backward compatible)
npm run version:major  # 1.0.0 -> 2.0.0 (breaking changes)
```

These scripts will automatically:

1. Bump version in package.json
2. Commit the change with message "chore: bump version to X.Y.Z"
3. Create a git tag `vX.Y.Z`

**⚠️ AI AGENT RULES:**

- NEVER manually edit the `version` field in package.json
- NEVER run `git tag` directly for versioning
- ALWAYS use `npm run version:patch|minor|major` commands
- Choose version type based on change scope:
  - `patch`: Bug fixes, minor tweaks
  - `minor`: New features, backward compatible changes
  - `major`: Breaking API changes

After versioning, push with tags:

```bash
git push && git push --tags
```

## Event Types

The loops respond to these OpenCode events:

| Event             | Task Loop             | Iteration Loop          |
| ----------------- | --------------------- | ----------------------- |
| `session.idle`    | Check todos, continue | Prompt to continue/done |
| `session.error`   | Pause continuation    | Mark recovering         |
| `session.deleted` | Clean up state        | Clear loop state        |
| `message.updated` | Cancel countdown      | Clear iteration lock    |

## Iteration Loop Completion

The agent signals completion by calling the `iteration_loop_complete` tool:

```typescript
// In tool handler:
iterationLoop.completeLoop(sessionID, "Task completed successfully")
```

**Key features:**

- Auto-generated codenames (e.g., "CRIMSON_FALCON") prevent pattern matching
- Tool-based completion is more reliable than text markers
- Unique codename per loop prevents models from copying previous markers

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**

- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
