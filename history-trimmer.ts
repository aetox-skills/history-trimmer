import type { Plugin } from "@opencode-ai/plugin"

export const HistoryTrimmerPlugin: Plugin = async () => {
  // Keep up to 3 user messages (prioritized), hard cap at 6 total
  // Override via env: MAX_USER_MSGS=5, HISTORY_KEEP=10
  const MAX_USER = parseInt(process.env.MAX_USER_MSGS ?? "3", 10)
  const HARD_CAP = parseInt(process.env.HISTORY_KEEP ?? "6", 10)

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const system = output.messages.filter(m => m.info.role === "system")
      const conversation = output.messages.filter(m => m.info.role !== "system")
      if (conversation.length <= HARD_CAP) return

      // --- Bug 1 fix: always keep at least HARD_CAP messages ---
      // Walk backwards from the end, mark where to cut.
      // We want up to MAX_USER user messages, but NEVER fewer than HARD_CAP total.
      let userCount = 0
      let cutIndex = Math.max(0, conversation.length - HARD_CAP) // fallback: keep last HARD_CAP

      for (let i = conversation.length - 1; i >= 0; i--) {
        if (conversation[i].info.role === "user") userCount++
        if (userCount > MAX_USER) {
          cutIndex = i + 1
          break
        }
      }

      let trimmed = conversation.slice(cutIndex)

      // Still enforce HARD_CAP (in case userCount never exceeded MAX_USER)
      if (trimmed.length > HARD_CAP) {
        trimmed = trimmed.slice(-HARD_CAP)
      }

      // --- Bug 2 fix: keep tool_call/tool_result pairs intact ---
      // Remove orphaned tool_results at the start (their tool_call was cut)
      while (trimmed.length > 0 && trimmed[0].info.role === "tool") {
        trimmed.shift()
      }

      // Remove orphaned tool_calls at the end (their tool_result was cut)
      // Check: does the next message after our slice in the original conversation
      // belong to the last assistant we kept?
      if (trimmed.length > 0) {
        const lastAsstIdx = conversation.indexOf(trimmed[trimmed.length - 1])
        if (lastAsstIdx !== -1 && lastAsstIdx + 1 < conversation.length &&
            conversation[lastAsstIdx + 1].info.role === "tool") {
          // The last assistant's tool result was cut → remove it
          trimmed.pop()
          // Also remove any tool messages preceding it
          while (trimmed.length > 0 && trimmed[trimmed.length - 1].info.role === "tool") {
            trimmed.pop()
          }
        }
      }

      output.messages = [...system, ...trimmed]
    }
  }
}
