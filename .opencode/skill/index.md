# Agent Loop Skills

Quick reference for working with the oc-agent-loop library.

## Available Skills

| Skill                                         | Description                                 |
| --------------------------------------------- | ------------------------------------------- |
| [architecture](./architecture.md)             | System design, state management, event flow |
| [development](./development.md)               | Build, test, version, code style            |
| [testing](./testing.md)                       | Unit tests, manual testing, debug logging   |
| [troubleshooting](./troubleshooting.md)       | Common issues and solutions                 |
| [plugin-integration](./plugin-integration.md) | OpenCode plugin setup and API               |

## Quick Start

```bash
# Build and test
npm run build && npm test

# Test with OpenCode (debug mode)
AGENT_LOOP_LOG_LEVEL=debug opencode

# Version and release
npm run version:patch && git push && git push --tags
```

## Key Concepts

1. **Task Loop**: Auto-continues when incomplete todos remain
2. **Iteration Loop**: Continues until completion marker detected
3. **Module-level state**: Shared across plugin instances
4. **Race condition guards**: Prevent duplicate countdowns

## Version History Highlights

| Version | Fix                                               |
| ------- | ------------------------------------------------- |
| v1.1.4  | Prevent duplicate completion messages             |
| v1.1.5  | Add debug logging                                 |
| v1.1.6  | Module-level state for multi-instance support     |
| v1.1.7  | Remove interfering status message after injection |
