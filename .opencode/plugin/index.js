/**
 * OpenCode Plugin - Task Continuation
 *
 * Automatically continues sessions when incomplete tasks remain.
 */

import { createTaskContinuation } from "../../dist/index.js"

// Store task continuation instances per session
const taskContinuations = new Map()

/**
 * Main plugin function that OpenCode calls
 */
export async function main({ directory, client }) {
  // Create plugin context
  const ctx = {
    directory,
    client: {
      session: {
        prompt: async (opts) => client.session.prompt(opts),
        todo: async (opts) => client.session.todo(opts),
      },
      tui: {
        showToast: async (opts) => client.tui.showToast(opts),
      },
    },
  }

  // Get or create task continuation for this session
  function getTaskContinuation(sessionID) {
    if (!taskContinuations.has(sessionID)) {
      taskContinuations.set(
        sessionID,
        createTaskContinuation(ctx, {
          countdownSeconds: 3,
          errorCooldownMs: 5000,
          toastDurationMs: 900,
        })
      )
    }
    return taskContinuations.get(sessionID)
  }

  return {
    /**
     * Event handler for OpenCode events
     */
    event: async ({ event }) => {
      const sessionID = event.properties?.sessionID || event.properties?.info?.sessionID
      if (!sessionID) return

      const tc = getTaskContinuation(sessionID)
      await tc.handler({ event })
    },

    /**
     * Direct access to task continuation
     */
    taskContinuation: {
      markRecovering: (sessionID) => {
        const tc = taskContinuations.get(sessionID)
        if (tc) tc.markRecovering(sessionID)
      },
      markRecoveryComplete: (sessionID) => {
        const tc = taskContinuations.get(sessionID)
        if (tc) tc.markRecoveryComplete(sessionID)
      },
      cleanup: (sessionID) => {
        const tc = taskContinuations.get(sessionID)
        if (tc) {
          tc.cleanup(sessionID)
          taskContinuations.delete(sessionID)
        }
      },
    },
  }
}

export default main
