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

export interface ToolInvocation {
  state: "call" | "partial-call" | "result"
  toolCallId: string
  toolName: string
  args?: unknown
  result?: string
  step?: number
}

export interface ToolInvocationPart {
  type: "tool-invocation"
  toolInvocation: ToolInvocation
}

export type RuntimePart =
  | ToolInvocationPart
  | { type: "text"; text: string; [key: string]: unknown }
  | { type: "reasoning"; text: string; [key: string]: unknown }
  | { type: string; [key: string]: unknown }

export interface RuntimeMessage {
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

// ── Core Logic (exported for testing) ──

/**
 * Trim conversation history to keep at most `maxUser` user messages
 * within a hard cap of `hardCap` total messages. Also validates
 * tool call/result pairs — orphaned parts are removed.
 *
 * Pure function — does not mutate input. Returns a new array.
 */
export function trimMessages(
  messages: RuntimeMessage[],
  maxUser: number,
  hardCap: number
): RuntimeMessage[] {
  // ── Step 1: User-priority capped trim (only when over HARD_CAP) ──
  let trimmed: RuntimeMessage[]
  if (messages.length <= hardCap) {
    trimmed = messages.slice() // copy — still need tool validation below
  } else {
    let userCount = 0
    let cutIndex = Math.max(0, messages.length - hardCap)

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].info?.role === "user") userCount++
      if (userCount > maxUser) {
        cutIndex = i + 1
        break
      }
    }

    trimmed = messages.slice(cutIndex)
    if (trimmed.length > hardCap) {
      trimmed = trimmed.slice(-hardCap)
    }
  }

  // ── Step 2: Tool call/result pair integrity ──
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

  // Track messages that had parts before cleanup
  const hadPartsBefore = new Set<RuntimeMessage>()
  for (const m of trimmed) {
    if ((m.parts ?? []).length > 0) hadPartsBefore.add(m)
  }

  // Remove orphaned tool call parts
  for (const m of trimmed) {
    m.parts = (m.parts ?? []).filter(p => {
      if (!isToolCall(p)) return true
      const id = getPairingId(p)
      return id ? resultIds.has(id) : true
    })
  }

  // Remove orphaned tool result parts
  for (const m of trimmed) {
    m.parts = (m.parts ?? []).filter(p => {
      if (!isToolResult(p)) return true
      const id = getPairingId(p)
      return id ? callIds.has(id) : true
    })
  }

  // Only remove messages that HAD parts before cleanup but now have none
  return trimmed.filter(m => {
    if ((m.parts ?? []).length > 0) return true
    return !hadPartsBefore.has(m)
  })
}

// ── Plugin ──

export const HistoryTrimmerPlugin: Plugin = async () => {
  const MAX_USER = intEnv("MAX_USER_MSGS", 5, 1)
  const HARD_CAP = intEnv("HISTORY_KEEP", 10, 2)

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const msgs = output.messages as RuntimeMessage[]
      const trimmed = trimMessages(msgs, MAX_USER, HARD_CAP)

      // CRITICAL: Reassigning output.messages is a silent no-op.
      // OpenCode holds the original array reference internally.
      // Must use splice for the mutation to take effect.
      // See: https://github.com/anomalyco/opencode/issues/25754
      output.messages.splice(0, output.messages.length, ...trimmed)
    }
  }
}
