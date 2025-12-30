# Agent Instructions

## Project Overview

TypeScript library providing agent loop mechanisms for OpenCode plugins. Extracted from [oh-my-opencode](https://github.com/open-code-ai/oh-my-opencode).

**Two main components:**

1. **Task Loop** - Auto-continues sessions when incomplete todos remain
2. **Iteration Loop** - Iteration-based loop with completion marker detection

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
- **Dependency injection** - `PluginContext` passed to factories
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

## Event Types

The loops respond to these OpenCode events:

| Event             | Task Loop             | Iteration Loop        |
| ----------------- | --------------------- | --------------------- |
| `session.idle`    | Check todos, continue | Check marker, iterate |
| `session.error`   | Pause continuation    | Mark recovering       |
| `session.deleted` | Clean up state        | Clear loop state      |
| `message.updated` | Cancel countdown      | -                     |
