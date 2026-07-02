import type { Plugin } from "@opencode-ai/plugin"

// ── Runtime type definitions (from OpenCode source message.ts) ──
//
// The "experimental.chat.messages.transform" hook receives messages in
// OpenCode's internal format, NOT the SDK Part types. Key differences:
//   - Tool calls/results are ToolInvocationPart (type: "tool-invocation")
//   - Pairing key is toolInvocation.toolCallId (not tool_call_id)
//   - Roles: "user" | "assistant" (no "system", no "tool" as separate roles)
//   - MUST mutate output.messages IN PLACE via splice (reassignment = silent no-op)
//
// We also handle legacy/provider field names defensively in case the runtime
// format differs from the documented source.

interface ToolInvocation {
  state: "call" | "partial-call" | "result"
  toolCallId: string
  toolName: string
  args?: unknown
  result?: string
  step?: number
}

interface ToolInvocationPart {
  type: "tool-invocation"
  toolInvocation: ToolInvocation
}

type RuntimePart =
  | ToolInvocationPart
  | { type: "text"; text: string; [key: string]: unknown }
  | { type: "reasoning"; text: string; [key: string]: unknown }
  | { type: string; [key: string]: unknown }

interface RuntimeMessage {
  info: { role: string; id: string; [key: string]: unknown }
  parts: RuntimePart[]
}

// ── Helpers ──

function intEnv(name: string, fallback: number, min = 1): number {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

/** Extract pairing ID from a part, trying all known field patterns */
function getPairingId(part: RuntimePart): string | undefined {
  // Primary: runtime ToolInvocationPart format (from source)
  if (part.type === "tool-invocation") {
    const ti = (part as ToolInvocationPart).toolInvocation
    if (ti?.toolCallId) return ti.toolCallId
  }
  // Secondary: SDK ToolPart format (callID)
  const sdk = part as { callID?: string; tool_call_id?: string; tool_use_id?: string; id?: string }
  if (typeof sdk.callID === "string") return sdk.callID
  // Legacy/provider: OpenAI/Anthropic field names
  if (typeof sdk.tool_call_id === "string") return sdk.tool_call_id
  if (typeof sdk.tool_use_id === "string") return sdk.tool_use_id
  // Fallback: part's own ID (used when part IS the reference)
  if (typeof sdk.id === "string") return sdk.id
  return undefined
}

/** Check if a ToolInvocationPart is a tool call (not result) */
function isToolCall(part: RuntimePart): boolean {
  if (part.type !== "tool-invocation") return false
  const ti = (part as ToolInvocationPart).toolInvocation
  return ti?.state === "call" || ti?.state === "partial-call"
}

/** Check if a ToolInvocationPart is a tool result */
function isToolResult(part: RuntimePart): boolean {
  if (part.type !== "tool-invocation") return false
  return (part as ToolInvocationPart).toolInvocation?.state === "result"
}

// ── Plugin ──

export const HistoryTrimmerPlugin: Plugin = async () => {
  const MAX_USER = intEnv("MAX_USER_MSGS", 5, 1)
  const HARD_CAP = intEnv("HISTORY_KEEP", 10, 2)

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const msgs = output.messages as RuntimeMessage[]

      // ── Step 1: User-priority capped trim (only when over HARD_CAP) ──
      let trimmed: RuntimeMessage[]
      if (msgs.length <= HARD_CAP) {
        trimmed = msgs.slice() // copy — still need tool validation below
      } else {
        let userCount = 0
        let cutIndex = Math.max(0, msgs.length - HARD_CAP)

        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].info?.role === "user") userCount++
          if (userCount > MAX_USER) {
            cutIndex = i + 1
            break
          }
        }

        trimmed = msgs.slice(cutIndex)
        if (trimmed.length > HARD_CAP) {
          trimmed = trimmed.slice(-HARD_CAP)
        }
      }

      // ── Step 2: Tool call/result pair integrity ──
      // Always run regardless of message count — even a 3-message
      // session can have orphaned tool parts from prior trimming.
      const callIds = new Set<string>()
      const resultIds = new Set<string>()

      for (const m of trimmed) {
        for (const p of m.parts ?? []) {
          const id = getPairingId(p)
          if (!id) continue
          if (isToolCall(p)) callIds.add(id)
          else if (isToolResult(p)) resultIds.add(id)
        }
      }

      // Track which messages had parts before cleanup (to only remove
      // messages that became empty due to cleanup, not pre-existing empties)
      const hadPartsBefore = new Set<RuntimeMessage>()
      for (const m of trimmed) {
        if ((m.parts ?? []).length > 0) hadPartsBefore.add(m)
      }

      // Remove orphaned tool call parts (no matching result in kept messages)
      for (const m of trimmed) {
        m.parts = (m.parts ?? []).filter(p => {
          if (!isToolCall(p)) return true
          const id = getPairingId(p)
          return id ? resultIds.has(id) : true // keep if we can't identify it
        })
      }

      // Remove orphaned tool result parts (no matching call in kept messages)
      for (const m of trimmed) {
        m.parts = (m.parts ?? []).filter(p => {
          if (!isToolResult(p)) return true
          const id = getPairingId(p)
          return id ? callIds.has(id) : true
        })
      }

      // Only remove messages that HAD parts before cleanup but now have none
      // (all their parts were orphaned tool parts). Messages that started
      // empty or had non-tool parts are kept.
      trimmed = trimmed.filter(m => {
        if ((m.parts ?? []).length > 0) return true // still has parts → keep
        return !hadPartsBefore.has(m) // was empty before → keep; had parts before → remove
      })

      // ── Step 3: In-place mutation ──
      // CRITICAL: Reassigning output.messages is a silent no-op.
      // OpenCode holds the original array reference internally.
      // Must use splice for the mutation to take effect.
      // See: https://github.com/anomalyco/opencode/issues/25754
      output.messages.splice(0, output.messages.length, ...trimmed)
    }
  }
}
