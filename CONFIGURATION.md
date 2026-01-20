# Agent Loop Plugin Configuration

## Configuration File

The agent-loop plugin supports two configuration file formats:

1. **JSONC** (recommended): `~/.local/share/opencode/agent-loop-plugin.jsonc`
2. **JSON**: `~/.local/share/opencode/agent-loop-plugin.json`

The plugin checks for `.jsonc` first, then falls back to `.json`.

## Example JSONC Config

```jsonc
{
  // Enable debug logging (default: true)
  "debug": true,

  // Countdown seconds before auto-continuation (default: 2)
  "countdownSeconds": 2,

  // Cooldown period in ms after errors (default: 3000)
  "errorCooldownMs": 3000,

  /*
   * Toast notification duration in ms
   * Default is 900ms
   */
  "toastDurationMs": 900,

  // Path to log file
  "logFilePath": "~/.local/share/opencode/agent-loop.log",
}
```

## Benefits of JSONC

- **Comments**: Add explanations to your config
- **Trailing commas**: No strict JSON compliance needed
- **Better readability**: Document your settings inline

## Configuration Options

| Option             | Type    | Default                                  | Description                      |
| ------------------ | ------- | ---------------------------------------- | -------------------------------- |
| `debug`            | boolean | `true`                                   | Enable debug logging             |
| `countdownSeconds` | number  | `2`                                      | Seconds before auto-continuation |
| `errorCooldownMs`  | number  | `3000`                                   | Cooldown after errors (ms)       |
| `toastDurationMs`  | number  | `900`                                    | Toast notification duration (ms) |
| `logFilePath`      | string  | `~/.local/share/opencode/agent-loop.log` | Path to log file                 |

## Priority Order

Configuration is loaded in this priority order:

1. **User options** (highest - passed programmatically)
2. **Config file** (medium - user configuration)
3. **Hardcoded defaults** (lowest - built-in defaults)

## Logging

Logs are written to the configured log file path (default: `~/.local/share/opencode/agent-loop.log`).

### Log Format

```json
{
  "timestamp": "2026-01-14T10:30:00.000Z",
  "level": "INFO",
  "message": "Task continuation injected",
  "data": {
    "sessionID": "session-123",
    "incompleteCount": 3
  },
  "source": "agent-loop-continuation"
}
```

## Error Handling

If the config file doesn't exist or is invalid, the plugin:

- Falls back to hardcoded defaults
- Logs a warning (unless file just doesn't exist)
- Continues operation normally
