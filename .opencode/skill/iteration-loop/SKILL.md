---
name: iteration-loop
description: >-
  Guide for using the Iteration Loop tools to handle complex, multi-iteration
  tasks that require structured continuation until completion.
version: "2.0"
updated: 2026-01-02
---

# Skill: Iteration Loop

## Overview

The Iteration Loop enables structured continuation of complex tasks. It automatically continues the session until you call `iteration_loop_complete` or max iterations are reached.

**Use when:**

- You see an `<iterationLoop>` tag in a user prompt
- A task requires multiple iterations to complete
- Long-running tasks need structured continuation
- Iterative refinement workflows (fix → test → fix → test)

## Tools

### iteration_loop_start

Start an iteration loop for a complex task. A unique codename is auto-generated.

```json
{
  "name": "iteration_loop_start",
  "description": "Start an iteration loop for a complex task.",
  "parameters": {
    "type": "object",
    "properties": {
      "task": {
        "type": "string",
        "description": "The task to work on iteratively"
      },
      "maxIterations": {
        "type": "number",
        "description": "Maximum number of iterations (default: 10)"
      }
    },
    "required": ["task"]
  }
}
```

### iteration_loop_complete

Signal that the task is complete. **This is the preferred way to stop the loop.**

```json
{
  "name": "iteration_loop_complete",
  "description": "Signal that the iteration loop task is complete.",
  "parameters": {
    "type": "object",
    "properties": {
      "summary": {
        "type": "string",
        "description": "Optional summary of what was accomplished"
      }
    }
  }
}
```

### iteration_loop_cancel

Cancel the active iteration loop (use when abandoning the task). No arguments required.

### iteration_loop_status

Get current loop status. No arguments required.

## Workflow

### 1. Parse the Tag

When you see an `<iterationLoop>` tag:

```xml
<iterationLoop max="15">
Refactor all components to use TypeScript strict mode
</iterationLoop>
```

### 2. Start the Loop

Call `iteration_loop_start` with parsed values:

```json
{
  "task": "Refactor all components to use TypeScript strict mode",
  "maxIterations": 15
}
```

The response will include a unique codename (e.g., "CRIMSON_FALCON").

### 3. Work on the Task

1. **Analyze** current state
2. **Make progress** on the task
3. **Validate** your changes
4. **Repeat** until complete

### 4. Complete the Loop

When **FULLY complete**, call `iteration_loop_complete`:

```json
{
  "summary": "All components refactored to strict mode, tests passing"
}
```

**CRITICAL:** Only call this when truly done. The loop auto-continues if you don't.

## Automatic Continuation

If you don't call `iteration_loop_complete`:

1. Session goes idle
2. Loop increments iteration counter
3. Continuation prompt injected
4. You continue working

Stops when:

- You call `iteration_loop_complete`
- Max iterations reached

## Best Practices

| DO                                        | DON'T                                |
| ----------------------------------------- | ------------------------------------ |
| Validate state at start of each iteration | Call complete prematurely            |
| Make incremental progress each iteration  | Forget to validate before completing |
| Call complete tool when done              | Set max iterations too low           |
| Set realistic max iterations              | Start new loop without canceling old |

## Examples

### Fix Linting Errors

```json
{
  "task": "Fix all ESLint errors in src/",
  "maxIterations": 10
}
```

Pattern: Run lint → Fix errors → Run lint → Repeat → `iteration_loop_complete`

### Implement Feature

```json
{
  "task": "Implement JWT authentication",
  "maxIterations": 25
}
```

Pattern: Create middleware → Endpoints → Tests → Verify → `iteration_loop_complete`

### Code Review Fixes

```json
{
  "task": "Address all code review comments on PR #42",
  "maxIterations": 15
}
```

## Combining with Task Loop

- **Iteration Loop**: High-level iteration control
- **Task Loop**: Ensures todos within each iteration complete

Flow:

1. Start Iteration Loop for overall task
2. Create todos for current iteration
3. Task Loop ensures todos complete
4. Session goes idle
5. Iteration Loop prompts for progress review
6. If not complete, starts next iteration
7. When done, call `iteration_loop_complete`

## Troubleshooting

| Issue                     | Solution                                   |
| ------------------------- | ------------------------------------------ |
| Loop doesn't continue     | Check if complete was accidentally called  |
| Loop continues after done | Call `iteration_loop_complete` tool        |
| Max iterations reached    | Break into smaller tasks or increase limit |
| No active loop            | Call `iteration_loop_start` first          |

## Configuration

Environment variables:

```bash
export AGENT_LOOP_MAX_ITERATIONS=50  # Default max iterations
export AGENT_LOOP_LOG_LEVEL=debug    # Enable debug logging
```

Note: Completion markers are auto-generated as unique codenames to prevent pattern matching.
