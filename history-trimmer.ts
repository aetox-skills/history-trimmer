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

      // --- Step 3: Validate tool_call/tool_result pairs by ID ---
      // Collect all tool_call IDs from kept assistant messages
      const toolCallIds = new Set<string>()
      for (const m of trimmed) {
        if (m.info.role !== "assistant") continue
        for (const p of (m.parts ?? [])) {
          const part = p as Record<string, unknown>
          const id = part.id ?? part.tool_call_id
          if (typeof id === "string") toolCallIds.add(id)
        }
      }

      // Collect all tool_result IDs from kept tool messages
      const toolResultIds = new Set<string>()
      for (const m of trimmed) {
        if (m.info.role !== "tool") continue
        for (const p of (m.parts ?? [])) {
          const part = p as Record<string, unknown>
          const id = part.tool_use_id ?? part.tool_call_id
          if (typeof id === "string") toolResultIds.add(id)
        }
      }

      // Remove assistant messages whose tool_call IDs are not all satisfied
      let i = trimmed.length - 1
      while (i >= 0) {
        if (trimmed[i].info.role === "assistant") {
          const ids = new Set<string>()
          for (const p of (trimmed[i].parts ?? [])) {
            const part = p as Record<string, unknown>
            const id = part.id ?? part.tool_call_id
            if (typeof id === "string") ids.add(id)
          }
          // If any tool_call ID is missing its result, remove this assistant + its tools
          let missing = false
          for (const id of ids) {
            if (!toolResultIds.has(id)) { missing = true; break }
          }
          if (missing) {
            // Remove assistant + any tool messages that follow it
            let removeCount = 1
            while (i + removeCount < trimmed.length && trimmed[i + removeCount].info.role === "tool") {
              // Also remove their IDs from the result set
              for (const p of (trimmed[i + removeCount].parts ?? [])) {
                const part = p as Record<string, unknown>
                const id = part.tool_use_id ?? part.tool_call_id
                if (typeof id === "string") toolResultIds.delete(id)
              }
              removeCount++
            }
            trimmed.splice(i, removeCount)
            i = Math.min(i, trimmed.length - 1)
            continue
          }
        }
        i--
      }

      // Remove orphaned tool results (IDs that don't belong to any kept assistant)
      i = 0
      while (i < trimmed.length) {
        if (trimmed[i].info.role === "tool") {
          let hasMatch = false
          for (const p of (trimmed[i].parts ?? [])) {
            const part = p as Record<string, unknown>
            const id = part.tool_use_id ?? part.tool_call_id
            if (typeof id === "string" && toolCallIds.has(id)) { hasMatch = true; break }
          }
          if (!hasMatch) {
            trimmed.splice(i, 1)
            continue
          }
        }
        i++
      }

      output.messages = [...system, ...trimmed]
    }
  }
}
