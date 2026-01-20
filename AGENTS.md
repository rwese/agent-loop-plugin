# Agent Loop Plugin - Development Guide

This is a minimal OpenCode plugin for task continuation.

## Quick Start

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Build distribution
npm run build
```

## Release Process

```bash
# Patch release (bug fixes)
npm run version:patch

# Minor release (new features)
npm run version:minor

# Major release (breaking changes)
npm run version:major
```

## Plugin Overview

- **Purpose**: Automatically continues sessions when incomplete tasks remain
- **Main file**: `src/plugin.ts`
- **Continuation logic**: `packages/continuation/index.ts`
- **Tests**: `__tests__/` (38 tests, all passing)

## Configuration

The plugin reads config from `~/.local/share/opencode/agent-loop-plugin.jsonc`

Options:

- `countdownSeconds`: Seconds before auto-continuation (default: 2)
- `errorCooldownMs`: Cooldown after errors (default: 3000)
- `debug`: Enable debug logging (default: true)
