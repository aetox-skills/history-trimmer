import type { Plugin } from "@opencode-ai/plugin"

export const HistoryTrimmerPlugin: Plugin = async () => {
  // Number of recent non-system messages to keep per call
  // Default 6 ≈ 2 exchanges (user + assistant + tool results)
  // Override via env: HISTORY_KEEP=10
  const KEEP = parseInt(process.env.HISTORY_KEEP ?? "6", 10)

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const system = output.messages.filter(m => m.info.role === "system")
      const conversation = output.messages.filter(m => m.info.role !== "system")

      if (conversation.length > KEEP) {
        const truncated = conversation.slice(-KEEP)
        output.messages = [...system, ...truncated]
      }
    }
  }
}
