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

/** Check if a part is a tool call (not result) */
function isToolCall(part: RuntimePart): boolean {
  // Primary: OpenCode runtime ToolInvocationPart format
  if (part.type === "tool-invocation") {
    const state = (part as ToolInvocationPart).toolInvocation?.state
    return state === "call" || state === "partial-call"
  }
  const p = part as Record<string, unknown>
  // SDK format: callID + state
  if (typeof p.callID === "string") {
    return (
      p.state === "running" || p.state === "call" || p.state === "partial-call"
    )
  }
  // Legacy OpenAI format: tool_call_id → this is a call
  // (avoid false-positives when both tool_call_id + tool_use_id exist)
  if (typeof p.tool_call_id === "string") {
    return typeof p.tool_use_id !== "string"
  }
  return false
}

/** Check if a part is a tool result */
function isToolResult(part: RuntimePart): boolean {
  // Primary: OpenCode runtime ToolInvocationPart format
  if (part.type === "tool-invocation") {
    return (part as ToolInvocationPart).toolInvocation?.state === "result"
  }
  // Secondary: SDK / legacy format
  const p = part as Record<string, unknown>
  return (
    (typeof p.callID === "string" &&
      (p.state === "completed" || p.state === "result")) ||
    typeof p.tool_use_id === "string"
  )
}

/**
 * Clean tool call/result pairs: remove orphaned parts from messages.
 * Mutates message.parts in-place during filter, then produces a
 * shallow copy of the result.  Callers MUST deep-clone input before
 * passing if they want to preserve the originals.
 */
function cleanToolPairs(messages: RuntimeMessage[]): RuntimeMessage[] {
  if (messages.length === 0) return messages

  // Collect IDs for pairing
  const callIds = new Set<string>()
  const resultIds = new Set<string>()

  for (const m of messages) {
    for (const p of m.parts ?? []) {
      const id = getPairingId(p)
      if (!id) continue
      if (isToolCall(p)) callIds.add(id)
      else if (isToolResult(p)) resultIds.add(id)
    }
  }

  // Track messages that had parts before cleanup
  const hadPartsBefore = new Set<RuntimeMessage>()
  for (const m of messages) {
    if ((m.parts ?? []).length > 0) hadPartsBefore.add(m)
  }

  // Remove orphaned tool call parts (no matching result)
  for (const m of messages) {
    m.parts = (m.parts ?? []).filter(p => {
      if (!isToolCall(p)) return true
      const id = getPairingId(p)
      return id ? resultIds.has(id) : true
    })
  }

  // Remove orphaned tool result parts (no matching call)
  for (const m of messages) {
    m.parts = (m.parts ?? []).filter(p => {
      if (!isToolResult(p)) return true
      const id = getPairingId(p)
      return id ? callIds.has(id) : true
    })
  }

  // Deep copy: we mutated parts in place, now make a clean copy
  const result = messages.map(m => ({
    info: { ...m.info },
    parts: [...(m.parts ?? [])]
  }))

  // Remove messages that had parts but now have none
  return result.filter(m => {
    if (m.parts.length > 0) return true
    const original = messages.find(x => x.info.id === m.info.id)
    return original ? !hadPartsBefore.has(original) : true
  })
}

// ── Core Logic (exported for testing) ──

/**
 * Trim conversation history to keep at most `maxUser` user messages
 * and `maxAssistant` assistant messages via independent per-role caps.
 *
 * `maxTool` controls tool invocation evidence in **two** mutually
 * compatible ways:
 *   1. **Legacy role format** — messages with `info.role === "tool"`
 *      are counted individually (some providers/SDKs).
 *   2. **Parts-based format** (OpenCode runtime) — tool invocations
 *      live as `ToolInvocationPart` inside `assistant.parts`. After
 *      per-role caps, unique tool invocation pairs (call + result)
 *      are counted; if they exceed `maxTool`, the oldest pairs are
 *      removed first, and empty assistant messages are cleaned up.
 *
 * Both mechanisms can coexist in the same session.
 *
 * `MAX_TOTAL` applies to the **rest** portion only (messages after
 * `preserveFirst`).  Prefix messages bypass both per-role caps and
 * MAX_TOTAL.  So the visible message count is:
 *   preserveFirst + min(MAX_TOTAL, role-capped_rest_length)
 *
 * When `preserveFirst > 0`, the first N messages are **never trimmed**.
 * Only the messages after the first N are subject to trimming. This is
 * useful for preserving system-style introduction messages while still
 * controlling conversation history length.
 *
 * Always passes through cleanToolPairs for final pair integrity.
 *
 * Pure function — does not mutate input. Returns a new array.
 */
export function trimMessages(
  messages: RuntimeMessage[],
  maxUser: number,
  maxAssistant: number,
  maxTool: number,
  minTotal: number,
  maxTotal: number,
  preserveFirst: number = 0
): RuntimeMessage[] {
  // Deep-clone input to guarantee purity — cleanToolPairs mutates parts
  // arrays internally before its final copy step.
  const working = messages.map(m => ({
    info: { ...m.info },
    parts: [...(m.parts ?? [])],
  }))

  // ── Step 0: MIN_TOTAL guard — don't bother trimming short sessions ──
  if (working.length <= minTotal) {
    return cleanToolPairs(working)
  }

  // ── Step 1: Split — preserve first N messages untouched ──
  const prefix = working.slice(0, preserveFirst)
  let rest = working.slice(preserveFirst)

  // ── Step 2: Per-role independent cap on rest only ──
  let userCount = 0, assistantCount = 0, toolCount = 0
  const keep: RuntimeMessage[] = []

  for (let i = rest.length - 1; i >= 0; i--) {
    const role = rest[i].info?.role
    let skip = false

    if (role === "user") {
      if (userCount >= maxUser) skip = true
      else userCount++
    } else if (role === "assistant") {
      if (assistantCount >= maxAssistant) skip = true
      else assistantCount++
    } else if (role === "tool") {
      if (toolCount >= maxTool) skip = true
      else toolCount++
    }
    // Messages with unknown/no role are always kept

    if (!skip) {
      keep.unshift(rest[i])
    }
  }

  let trimmedRest = keep

  // ── Step 2.5: Tool invocation pair cap (parts-based format) ──
  // After per-role caps, count unique tool invocation pairs (call + result)
  // across kept messages.  If pairs exceed maxTool, remove the oldest pairs.
  // This controls tool evidence for the OpenCode runtime format where
  // tool invocations are ToolInvocationPart inside assistant messages,
  // NOT separate role="tool" messages.
  //
  // Only complete pairs (both call AND result present) are counted.
  // Partial/incomplete invocations are left for cleanToolPairs to handle.
  // The legacy role==="tool" counting in Step 2 already handled that format.
  if (trimmedRest.length > 0) {
    // 1. Collect tool invocation parts across kept messages
    const pairInfo = new Map<string, { hasCall: boolean; hasResult: boolean }>()
    const insertOrder: string[] = []

    for (const msg of trimmedRest) {
      for (const p of msg.parts ?? []) {
        if (p.type !== "tool-invocation") continue
        const ti = (p as ToolInvocationPart).toolInvocation
        if (!ti?.toolCallId) continue
        const id = ti.toolCallId
        if (!pairInfo.has(id)) {
          pairInfo.set(id, { hasCall: false, hasResult: false })
          insertOrder.push(id)
        }
        const entry = pairInfo.get(id)!
        if (ti.state === "call" || ti.state === "partial-call") entry.hasCall = true
        if (ti.state === "result") entry.hasResult = true
      }
    }

    // 2. Determine complete pairs in insert order (oldest first)
    const completePairs = insertOrder.filter(id => {
      const p = pairInfo.get(id)!
      return p.hasCall && p.hasResult
    })

    // 3. If over limit, remove oldest pairs
    if (completePairs.length > maxTool) {
      const removeCount = completePairs.length - maxTool
      const removeIds = new Set(completePairs.slice(0, removeCount))

      for (const msg of trimmedRest) {
        msg.parts = (msg.parts ?? []).filter(p => {
          if (p.type === "tool-invocation") {
            const ti = (p as ToolInvocationPart).toolInvocation
            return !(ti?.toolCallId && removeIds.has(ti.toolCallId))
          }
          return true
        })
      }

      // Remove messages that became empty (all parts were tool invocations)
      trimmedRest = trimmedRest.filter(m => (m.parts ?? []).length > 0)
    }
  }

  // ── Step 3: MAX_TOTAL absolute ceiling on rest portion only ──
  // Applies only to the `rest` portion (messages after preserveFirst).
  // Prefix messages bypass this cap entirely, so the TRUE visible max is:
  //   PRESERVE_FIRST + min(MAX_TOTAL, len(role-capped_rest))
  // This is a safety fence — per-role caps typically fire first, so
  // MAX_TOTAL acts as a backup guard only.
  if (trimmedRest.length > maxTotal) {
    trimmedRest = trimmedRest.slice(-maxTotal)
    // Strip orphan leading tool messages created by the slice
    while (trimmedRest.length > 0 && trimmedRest[0].info?.role === "tool") {
      trimmedRest.shift()
    }
  }

  // ── Step 4: Rejoin prefix + trimmed rest ──
  const trimmed = [...prefix, ...trimmedRest]

  // ── Step 5: Tool call/result pair integrity across all messages ──
  return cleanToolPairs(trimmed)
}

// ── Plugin ──

export const HistoryTrimmerPlugin: Plugin = async () => {
  const MAX_USER = intEnv("MAX_USER_MSGS", 10, 1)
  const MAX_ASSISTANT = intEnv("MAX_ASSISTANT_MSGS", 14, 1)
  const MAX_TOOL = intEnv("MAX_TOOL_MSGS", 14, 1)
  const MIN_TOTAL = intEnv("MIN_TOTAL_MSGS", 8, 2)
  const MAX_TOTAL = intEnv("MAX_TOTAL_MSGS", 44, 5)
  const PRESERVE_FIRST = intEnv("PRESERVE_FIRST_MSGS", 2, 0)

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const msgs = output.messages as RuntimeMessage[]
      const trimmed = trimMessages(msgs, MAX_USER, MAX_ASSISTANT, MAX_TOOL, MIN_TOTAL, MAX_TOTAL, PRESERVE_FIRST)

      // CRITICAL: Reassigning output.messages is a silent no-op.
      // OpenCode holds the original array reference internally.
      // Must use splice for the mutation to take effect.
      // See: https://github.com/anomalyco/opencode/issues/25754
      output.messages.splice(0, output.messages.length, ...trimmed)
    }
  }
}
