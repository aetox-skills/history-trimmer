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

      // Walk from end, collect up to MAX_USER user messages + everything after
      let userCount = 0
      let cutIndex = conversation.length

      for (let i = conversation.length - 1; i >= 0; i--) {
        if (conversation[i].info.role === "user") {
          userCount++
          if (userCount > MAX_USER) {
            cutIndex = i + 1  // cut before this user message
            break
          }
        }
      }

      const trimmed = conversation.slice(cutIndex)
      output.messages = [...system, ...trimmed.slice(-HARD_CAP)]
    }
  }
}
