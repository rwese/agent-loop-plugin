# Changelog

## [5.1.0] - 2026-01-14

### Added

- JSONC configuration file support (`.jsonc` files with comments)
- Modular plugin architecture with separate packages:
  - `@agent-loop/tools` - Shared utilities (types, logger, session context)
  - `agent-loop-goals` - Goal management plugin
  - `agent-loop-continuation` - Task continuation plugin
- Configuration file support at `~/.local/share/opencode/agent-loop-plugin.jsonc`
- Example configuration file (`example-config.agent-loop-plugin.jsonc`)
- Comprehensive configuration documentation (`CONFIGURATION.md`)

### Changed

- Completely removed all console logging output (debug, info, warn, error)
- Plugin is now silent by default, no initialization messages
- Bundle size reduced by ~7.6 KB (from 497.1 KB to 489.5 KB)
- Refactored for cleaner architecture and better separation of concerns
- Removed debug logging from source files

### Fixed

- Config file not found errors no longer logged as warnings
- Proper handling of missing config files with silent fallback

### Removed

- All debug logging statements
- Console output during plugin initialization
- Logger imports and initialization from main plugin

## [5.0.1] - Previous

- Initial release with task continuation and goal management
