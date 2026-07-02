import type { Plugin } from "@opencode-ai/plugin"

// Safe integer from env: validates range, falls back on bad input
function intEnv(name: string, fallback: number, min = 1): number {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

export const HistoryTrimmerPlugin: Plugin = async () => {
  const MAX_USER = intEnv("MAX_USER_MSGS", 5, 1)
  const HARD_CAP = intEnv("HISTORY_KEEP", 10, 2)

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const system = output.messages.filter(m => m.info.role === "system")
      const conversation = output.messages.filter(m => m.info.role !== "system")
      if (conversation.length <= HARD_CAP) return

      // --- Step 1: User-priority capped trim ---
      // Walk from end, try to keep up to MAX_USER user messages.
      // Fallback: never drop below the last HARD_CAP messages.
      let userCount = 0
      let cutIndex = Math.max(0, conversation.length - HARD_CAP)

      for (let i = conversation.length - 1; i >= 0; i--) {
        if (conversation[i].info.role === "user") userCount++
        if (userCount > MAX_USER) {
          cutIndex = i + 1
          break
        }
      }

      let trimmed = conversation.slice(cutIndex)

      // Enforce HARD_CAP (triggers when too few users were found)
      if (trimmed.length > HARD_CAP) {
        trimmed = trimmed.slice(-HARD_CAP)
      }

      // --- Step 2: Remove orphaned leading tool results ---
      while (trimmed.length > 0 && trimmed[0].info.role === "tool") {
        trimmed.shift()
      }

      // --- Step 3: Validate tool_call/tool_result pairs by counting per assistant ---
      // For each assistant message, check that ALL its tool results made it into the slice.
      // If any are missing, remove the assistant *and* whatever tool results survived.
      let i = trimmed.length - 1
      while (i >= 0) {
        if (trimmed[i].info.role === "assistant") {
          const origIdx = conversation.indexOf(trimmed[i])

          // Count tool messages that follow this assistant in the original array
          let origToolCount = 0
          for (let j = origIdx + 1; j < conversation.length && conversation[j].info.role === "tool"; j++) {
            origToolCount++
          }

          if (origToolCount > 0) {
            // Count tool messages that survived in our trimmed slice
            let keptToolCount = 0
            for (let j = i + 1; j < trimmed.length && trimmed[j].info.role === "tool"; j++) {
              keptToolCount++
            }

            if (keptToolCount < origToolCount) {
              // Not all tool results made it → unsafe to keep this assistant
              trimmed.splice(i, 1 + keptToolCount)
              i = Math.min(i, trimmed.length - 1)
              continue
            }
          }
        }
        i--
      }

      output.messages = [...system, ...trimmed]
    }
  }
}
