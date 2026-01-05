# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2025-01-05

### Changed

- **BREAKING**: Renamed package from `oc-agent-loop` to `agent-loop-plugin`
- **BREAKING**: Updated package exports to use `./plugin` instead of `./.opencode/plugin`
- **BREAKING**: Renamed plugin entry point from `agent-loop.js` to `index.js`
- Updated repository URL from `https://codeberg.org/nope-at/oc-agent-loop.git` to `https://codeberg.org/nope-at/agent-loop-plugin.git`
- Improved package description to "Agent Loop Plugin - Task continuation and iteration loops for OpenCode plugins"
- Enhanced keywords with "plugin" and "iteration"
- Updated all documentation and examples to reflect new package name

### Added

- TypeScript declaration file (`.d.ts`) for plugin exports
- Plugin exports are now accessible via `agent-loop-plugin/plugin`

### Fixed

- Fixed plugin file exports structure for better npm compatibility

### Migration Guide

**Before:**

```bash
npm install oc-agent-loop
import { AgentLoopPlugin } from "oc-agent-loop/.opencode/plugin"
```

**After:**

```bash
npm install agent-loop-plugin
import { AgentLoopPlugin } from "agent-loop-plugin/plugin"
```

## [2.2.0] - 2025-01-03

### Changed

- Updated dependencies to latest versions
- Improved TypeScript type definitions

## [2.1.0] - 2025-01-02

### Added

- Advisor-based iteration loop completion detection
- Enhanced iteration loop evaluation prompts

### Changed

- Improved iteration loop state management
- Enhanced advisor integration for completion evaluation

## [2.0.0] - 2024-12-30

### Changed

- **BREAKING**: Major refactoring of iteration loop completion mechanism
- Replaced text-based completion markers with tool-based completion
- Auto-generated unique codenames to prevent pattern matching

### Added

- Tool-based completion system (`iteration_loop_complete` tool)
- Auto-generated completion codenames (e.g., "CRIMSON_FALCON")
- Enhanced iteration loop state persistence
- New iteration loop tools: `iteration_loop_start`, `iteration_loop_complete`, `iteration_loop_cancel`, `iteration_loop_status`

### Removed

- Text-based completion marker parsing (deprecated)
- Manual completion marker configuration (replaced by auto-generated codenames)

## [1.4.0] - 2024-12-28

### Added

- Tool-based completion system
- Auto-generated completion codenames

## [1.3.0] - 2024-12-27

### Added

- Help agent support for subagent feedback
- Enhanced continuation prompts with task tool instructions

## [1.2.0] - 2024-12-26

### Added

- `onCountdownStart` callback for plugin-side timer management
- Improved timer handling in plugin environment

## [1.1.0] - 2024-12-25

### Added

- Module-level state sharing across plugin instances
- Improved error handling and recovery

## [1.0.0] - 2024-12-24

### Added

- Initial release of standalone agent loop mechanisms
- Task Loop for automatic task continuation
- Iteration Loop for iterative task completion
- Comprehensive TypeScript type definitions
