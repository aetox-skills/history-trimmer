/**
 * Tests for history-trimmer plugin
 * Run: npx tsx --test history-trimmer.test.ts
 */
import { describe, it } from "node:test"
import assert from "node:assert"
import { trimMessages, type RuntimeMessage, type RuntimePart } from "./history-trimmer"

// ── Default test params (mirror production defaults) ──
const DP = { MAX_USER: 5, MAX_ASST: 10, MAX_TOOL: 7, MIN_TOTAL: 5, MAX_TOTAL: 30 }

// ── Mock helpers ──

function userMsg(id: string, text = "hello"): RuntimeMessage {
  return {
    info: { role: "user", id },
    parts: [{ type: "text", text }]
  }
}

function assistantMsg(id: string, parts: RuntimePart[] = []): RuntimeMessage {
  return {
    info: { role: "assistant", id },
    parts: parts.length > 0 ? parts : [{ type: "text", text: "ok" }]
  }
}

function toolMsg(id: string, text = "result"): RuntimeMessage {
  return {
    info: { role: "tool", id },
    parts: [{ type: "text", text }]
  }
}

function toolCallPart(toolCallId: string, toolName = "bash"): RuntimePart {
  return {
    type: "tool-invocation",
    toolInvocation: { state: "call", toolCallId, toolName }
  }
}

function toolResultPart(toolCallId: string, toolName = "bash", result = "output"): RuntimePart {
  return {
    type: "tool-invocation",
    toolInvocation: { state: "result", toolCallId, toolName, result }
  }
}

function userAsstPairs(n: number): RuntimeMessage[] {
  const msgs: RuntimeMessage[] = []
  for (let i = 0; i < n; i++) {
    msgs.push(userMsg(`u${i}`))
    msgs.push(assistantMsg(`a${i}`))
  }
  return msgs
}

// ── Tests ──

describe("History Trimmer (per-role caps)", () => {
  const { MAX_USER, MAX_ASST, MAX_TOOL, MIN_TOTAL, MAX_TOTAL } = DP

  // ── MIN_TOTAL ──

  describe("MIN_TOTAL guard", () => {
    it("no-op when messages <= MIN_TOTAL", () => {
      const msgs = [userMsg("1"), assistantMsg("2"), userMsg("3")]
      const result = trimMessages([...msgs], MAX_USER, MAX_ASST, MAX_TOOL, 5, MAX_TOTAL)
      assert.equal(result.length, 3)
    })

    it("single message session passes through", () => {
      const msgs = [userMsg("u1")]
      const result = trimMessages([...msgs], MAX_USER, MAX_ASST, MAX_TOOL, 1, MAX_TOTAL)
      assert.equal(result.length, 1)
    })
  })

  // ── Per-role cap trim ──

  describe("per-role caps", () => {
    it("keeps at most MAX_USER most recent user messages", () => {
      const msgs = userAsstPairs(10) // 10 user + 10 assistant = 20 messages
      const result = trimMessages([...msgs], 3, MAX_ASST, MAX_TOOL, MIN_TOTAL, MAX_TOTAL)
      const users = result.filter(m => m.info.role === "user")
      assert.equal(users.length, 3, `expected 3 users, got ${users.length}`)
      assert.equal(users[0].info.id, "u7")
      assert.equal(users[1].info.id, "u8")
      assert.equal(users[2].info.id, "u9")
    })

    it("keeps at most MAX_ASSISTANT most recent assistant messages", () => {
      const msgs = userAsstPairs(15)
      const result = trimMessages([...msgs], MAX_USER, 3, MAX_TOOL, MIN_TOTAL, MAX_TOTAL)
      const assitants = result.filter(m => m.info.role === "assistant")
      assert.equal(assitants.length, 3, `expected 3 assistants, got ${assitants.length}`)
    })

    it("keeps at most MAX_TOOL tool messages", () => {
      const msgs: RuntimeMessage[] = [
        userMsg("u1"), assistantMsg("a1"), toolMsg("t1"),
        userMsg("u2"), assistantMsg("a2"), toolMsg("t2"),
        userMsg("u3"), assistantMsg("a3"), toolMsg("t3"),
        userMsg("u4"), assistantMsg("a4"), toolMsg("t4"),
        userMsg("u5"), assistantMsg("a5"), toolMsg("t5"),
        userMsg("u6"), assistantMsg("a6"), toolMsg("t6"),
      ]
      const result = trimMessages([...msgs], MAX_USER, MAX_ASST, 2, MIN_TOTAL, MAX_TOTAL)
      const tools = result.filter(m => m.info.role === "tool")
      assert.equal(tools.length, 2, `expected 2 tools, got ${tools.length}`)
    })

    it("applies each per-role cap independently", () => {
      const msgs = userAsstPairs(8) // 8 user + 8 assistant = 16
      const result = trimMessages([...msgs], 4, 4, 0, MIN_TOTAL, MAX_TOTAL)
      // Should have 4 user + 4 assistant = 8 messages
      assert.equal(result.length, 8)
      const users = result.filter(m => m.info.role === "user")
      const assts = result.filter(m => m.info.role === "assistant")
      assert.equal(users.length, 4)
      assert.equal(assts.length, 4)
    })

    it("keeps most recent messages at tail", () => {
      const msgs = [
        userMsg("u1", "oldest"),
        assistantMsg("a1"),
        userMsg("u2", "middle"),
        assistantMsg("a2"),
        userMsg("u3", "newest"),
      ]
      const result = trimMessages([...msgs], 3, 3, 0, 2, MAX_TOTAL)
      const lastUser = result.filter(m => m.info.role === "user").pop()
      assert.ok(lastUser)
      assert.equal((lastUser!.parts[0] as RuntimePart).text, "newest")
    })
  })

  // ── MAX_TOTAL absolute ceiling ──

  describe("MAX_TOTAL absolute ceiling", () => {
    it("caps total messages when per-role caps alone aren't binding", () => {
      const msgs = userAsstPairs(10) // 20 messages, all 3 per-role caps too loose
      // With roomy per-role caps but tight MAX_TOTAL=6
      const result = trimMessages([...msgs], 10, 10, 0, 2, 6)
      assert.ok(result.length <= 6, `expected <= 6, got ${result.length}`)
    })

    it("MAX_TOTAL > per-role sum works as expected", () => {
      const msgs = userAsstPairs(5) // 10 messages
      // Per-role caps: 2 user + 3 assistant. MAX_TOTAL=20 won't trigger
      const result = trimMessages([...msgs], 2, 3, 0, 2, 20)
      assert.equal(result.length, 5) // 2 users + 3 assistants = 5
    })

    it("strips orphan leading tools after MAX_TOTAL trim", () => {
      const msgs: RuntimeMessage[] = [
        toolMsg("t_orphan"),
        userMsg("u1"), assistantMsg("a1"),
        userMsg("u2"), assistantMsg("a2"),
      ]
      const result = trimMessages([...msgs], 5, 5, 0, 2, 3)
      // After trim to last 3: [a1, u2, a2] — no tool at front, all fine
      assert.ok(result.length > 0)
      assert.notEqual(result[0].info.role, "tool", "leading tool should be stripped")
    })

    it("respects MAX_TOTAL even when smaller than MIN_TOTAL", () => {
      const msgs = userAsstPairs(3) // 6 messages
      const result = trimMessages([...msgs], 5, 5, 0, 5, 3)
      // 6 > 5 (MIN_TOTAL), so trim runs → MAX_TOTAL=3 is the hard ceiling
      assert.equal(result.length, 3, "MAX_TOTAL absolute ceiling overrides MIN_TOTAL guard")
    })
  })

  // ── Tool pair integrity ──

  describe("tool pair integrity", () => {
    it("keeps tool call with matching result", () => {
      const msgs = [
        assistantMsg("a1", [toolCallPart("tc1")]),
        userMsg("u1"),
        assistantMsg("a2", [toolResultPart("tc1")]),
      ]
      const result = trimMessages([...msgs], 5, 5, 5, 2, 30)
      assert.equal(result.length, 3)
      const toolParts = result.flatMap(m => m.parts ?? []).filter(
        p => p.type === "tool-invocation"
      )
      assert.equal(toolParts.length, 2, "both tool call and result should be preserved")
    })

    it("removes tool call part when result is not in kept messages", () => {
      const msgs = [
        userMsg("u0"), assistantMsg("a0"),
        userMsg("u1"), assistantMsg("a1", [toolCallPart("tc_orphan")]),
        userMsg("u2"), assistantMsg("a2"),
        userMsg("u3"), assistantMsg("a3"),
      ]
      const result = trimMessages([...msgs], 2, 5, 0, 2, 30)
      const a1Msg = result.find(m => m.info.id === "a1")
      if (a1Msg) {
        const toolParts = (a1Msg.parts ?? []).filter(p => p.type === "tool-invocation")
        assert.equal(toolParts.length, 0, "orphaned tool call should be removed")
        assert.ok((a1Msg.parts ?? []).length > 0, "a1 should have non-tool parts remaining")
      }
    })

    it("removes orphaned tool result (no matching call)", () => {
      const msgs = [
        assistantMsg("a1", [toolResultPart("tc_orphan")]),
        userMsg("u1"),
        assistantMsg("a2"),
      ]
      const result = trimMessages([...msgs], 5, 5, 0, 2, 30)
      const a1 = result.find(m => m.info.id === "a1")
      if (a1) {
        const resultParts = (a1.parts ?? []).filter(
          p => p.type === "tool-invocation" && p.toolInvocation?.state === "result"
        )
        assert.equal(resultParts.length, 0, "orphaned tool result should be removed")
      }
    })

    it("removes message if all its parts were cleaned up", () => {
      const msgs = [
        assistantMsg("a1", [toolResultPart("tc_orphan")]),
        userMsg("u1"),
        assistantMsg("a2"),
      ]
      const result = trimMessages([...msgs], 5, 5, 0, 2, 30)
      const a1 = result.find(m => m.info.id === "a1")
      assert.equal(a1, undefined, "empty message should be removed")
    })
  })

  // ── preserveFirst ──

  describe("preserveFirst", () => {
    it("preserveFirst=0 (default) behaves the same as before", () => {
      const msgs = userAsstPairs(10) // 20 messages
      const result = trimMessages([...msgs], 3, 3, 0, 2, 30, 0)
      assert.equal(result.length, 6) // 3 user + 3 assistant
    })

    it("preserves first N messages untouched", () => {
      // 4 user-asst pairs (8 messages), per-role caps=2, preserveFirst=2
      const msgs = userAsstPairs(4) // u0,a0,u1,a1,u2,a2,u3,a3
      const result = trimMessages([...msgs], 2, 2, 0, 2, 30, 2)
      // prefix = [u0, a0] ← preserved
      // rest = [u1,a1,u2,a2,u3,a3] → per-role caps=2 → keep u2,a2,u3,a3
      // total = [u0,a0,u2,a2,u3,a3] = 6
      assert.equal(result.length, 6, `expected 6, got ${result.length}`)
      assert.equal(result[0].info.id, "u0", "first preserved message")
      assert.equal(result[1].info.id, "a0", "second preserved message")
      assert.equal(result[result.length - 1].info.id, "a3", "last should be most recent")
    })

    it("preserveFirst exceeds session length — no trimming of rest", () => {
      const msgs = userAsstPairs(3) // 6 messages
      const result = trimMessages([...msgs], 1, 1, 0, 2, 30, 10)
      assert.equal(result.length, 6, "all preserved, none trimmed")
    })

    it("preserveFirst interacts correctly with MAX_TOTAL ceiling", () => {
      // 5 user-asst pairs (10 messages), preserveFirst=2
      const msgs = userAsstPairs(5) // u0,a0,u1,a1,u2,a2,u3,a3,u4,a4
      // preserveFirst=2 → prefix=[u0,a0]
      // rest=[u1,a1,u2,a2,u3,a3,u4,a4], MAX_TOTAL=4 → keep last 4: a2,u3,a3,u4,a4? no, that's 5
      // Actually: slice(-4) gives [a2,u3,a3,u4] then strip leading tool (none) = 4
      // total = [u0,a0,a2,u3,a3,u4] = 6
      const result = trimMessages([...msgs], 5, 5, 0, 2, 4, 2)
      assert.ok(result.length > 0, "result should not be empty")
      assert.equal(result[0].info.id, "u0", "prefix still intact")
      assert.equal(result[1].info.id, "a0", "prefix still intact")
    })

    it("preserveFirst with per-role caps — only rest is capped", () => {
      const msgs: RuntimeMessage[] = [
        userMsg("intro"), assistantMsg("intro_reply"), // preserve these 2
        userMsg("u0"), assistantMsg("a0"),
        userMsg("u1"), assistantMsg("a1"),
        userMsg("u2"), assistantMsg("a2"),
        userMsg("u3"), assistantMsg("a3"),
      ] // 10 total
      const result = trimMessages([...msgs], 2, 2, 0, 2, 30, 2)
      // prefix = [intro, intro_reply] ← preserved
      // rest = [u0,a0,u1,a1,u2,a2,u3,a3] → per-role caps(2,2) → keep u2,a2,u3,a3 = 4
      // total = prefix(2) + rest(4) = 6
      // User messages: intro (from prefix) + u2 + u3 = 3 (exceeds maxUser=2 — intentional)
      assert.equal(result.length, 6, `expected 6, got ${result.length}`)
      const users = result.filter(m => m.info.role === "user")
      assert.equal(users.length, 3, "preserveFirst bypasses per-role cap")
      assert.equal(users[0].info.id, "intro", "intro user preserved")
    })

    it("cleanToolPairs works across prefix/rest boundary", () => {
      const tcId = "cross_boundary"
      const msgs: RuntimeMessage[] = [
        assistantMsg("intro", [toolCallPart(tcId, "bash")]), // preserved (tool call)
        userMsg("u0"), assistantMsg("a0", [toolResultPart(tcId, "bash")]), // result in rest
      ]
      const result = trimMessages([...msgs], 5, 5, 5, 2, 30, 1)
      // prefix = [intro (with toolCall)]
      // rest = [u0, a0 (with toolResult)]
      // cleanToolPairs across all should find both call and result → preserved
      assert.equal(result.length, 3)
      const allToolParts = result.flatMap(m => m.parts ?? []).filter(
        p => p.type === "tool-invocation"
      )
      assert.equal(allToolParts.length, 2, "cross-boundary pair preserved")
    })

    it("preserveFirst with MIN_TOTAL guard — passes through if short", () => {
      const msgs = [userMsg("u0"), assistantMsg("a0"), userMsg("u1")] // 3 total
      const result = trimMessages([...msgs], 5, 5, 0, 5, 30, 2)
      assert.equal(result.length, 3, "MIN_TOTAL guard fires before preserveFirst split")
    })
  })

  // ── Edge cases ──

  describe("edge cases", () => {
    it("handles messages without parts", () => {
      const m1: RuntimeMessage = { info: { role: "user", id: "u1" }, parts: [] }
      const m2: RuntimeMessage = { info: { role: "assistant", id: "a1" }, parts: [] }
      const result = trimMessages([m1, m2], MAX_USER, MAX_ASST, MAX_TOOL, 2, MAX_TOTAL)
      assert.equal(result.length, 2)
    })

    it("handles undefined parts gracefully", () => {
      const m1: RuntimeMessage = {
        info: { role: "user", id: "u1" },
        parts: undefined as unknown as RuntimePart[]
      }
      const result = trimMessages([m1], MAX_USER, MAX_ASST, MAX_TOOL, 1, MAX_TOTAL)
      assert.equal(result.length, 1)
    })

    it("consecutive user messages without assistant between them", () => {
      const msgs = [
        userMsg("u1"),
        userMsg("u2"),
        userMsg("u3"),
        assistantMsg("a1"),
      ]
      const result = trimMessages([...msgs], 2, 5, 0, 2, MAX_TOTAL)
      const users = result.filter(m => m.info.role === "user")
      assert.equal(users.length, 2)
    })

    it("all tool messages, no users or assistants", () => {
      const msgs = [
        toolMsg("t1"), toolMsg("t2"), toolMsg("t3"),
        toolMsg("t4"), toolMsg("t5"), toolMsg("t6"),
      ]
      const result = trimMessages([...msgs], 5, 5, 3, 2, 30)
      const tools = result.filter(m => m.info.role === "tool")
      assert.equal(tools.length, 3)
    })

    it("handles SDK callID format for tool pairing", () => {
      const sdkCall: RuntimePart = {
        type: "tool",
        callID: "sdk-call-1",
        state: "running",
        tool: "bash"
      }
      const sdkResult: RuntimePart = {
        type: "tool",
        callID: "sdk-call-1",
        state: "completed",
        tool: "bash"
      }
      const msgs = [
        assistantMsg("a1", [sdkCall]),
        userMsg("u1"),
        assistantMsg("a2", [sdkResult]),
      ]
      const result = trimMessages([...msgs], 5, 5, 5, 2, 30)
      assert.equal(result.length, 3)
      // Verify both parts survive cleanup (paired correctly)
      const allToolParts = result.flatMap(m => m.parts ?? [])
      const sdks = allToolParts.filter(p => (p as Record<string, unknown>).callID === "sdk-call-1")
      assert.equal(sdks.length, 2, "SDK paired call+result should survive cleanup")
    })

    it("removes orphan SDK call (no matching result)", () => {
      const orphanCall: RuntimePart = {
        type: "tool",
        callID: "orphan-sdk",
        state: "running",
        tool: "bash"
      }
      const msgs = [
        assistantMsg("a1", [orphanCall]),
        userMsg("u1"),
        assistantMsg("a2"),
      ]
      const result = trimMessages([...msgs], 5, 5, 5, 2, 30)
      const a1 = result.find(m => m.info.id === "a1")
      if (a1) {
        const toolParts = (a1.parts ?? []).filter(
          p => (p as Record<string, unknown>).callID === "orphan-sdk"
        )
        assert.equal(toolParts.length, 0, "orphan SDK call should be removed")
      }
    })

    it("removes orphan SDK result (no matching call)", () => {
      const orphanResult: RuntimePart = {
        type: "tool",
        callID: "orphan-sdk-result",
        state: "completed",
        tool: "bash"
      }
      const msgs = [
        assistantMsg("a1", [orphanResult]),
        userMsg("u1"),
        assistantMsg("a2"),
      ]
      const result = trimMessages([...msgs], 5, 5, 5, 2, 30)
      const a1 = result.find(m => m.info.id === "a1")
      if (a1) {
        const toolParts = (a1.parts ?? []).filter(
          p => (p as Record<string, unknown>).callID === "orphan-sdk-result"
        )
        assert.equal(toolParts.length, 0, "orphan SDK result should be removed")
      }
    })

    it("handles legacy tool_call_id/tool_use_id format", () => {
      // Legacy call: has tool_call_id (OpenAI format), no tool_use_id
      const legacyCall: RuntimePart = {
        type: "tool",
        tool_call_id: "legacy-1"
      }
      // Legacy result: has tool_use_id (Anthropic format)
      const legacyResult: RuntimePart = {
        type: "tool",
        tool_use_id: "legacy-1"
      }
      const msgs = [
        assistantMsg("a1", [legacyCall]),
        userMsg("u1"),
        assistantMsg("a2", [legacyResult]),
      ]
      const result = trimMessages([...msgs], 5, 5, 5, 2, 30)
      assert.equal(result.length, 3, "paired legacy call+result should survive")
      // Verify both parts survive cleanup
      const allToolParts = result.flatMap(m => m.parts ?? [])
      const callParts = allToolParts.filter(p => (p as Record<string, unknown>).tool_call_id === "legacy-1")
      const resultParts = allToolParts.filter(p => (p as Record<string, unknown>).tool_use_id === "legacy-1")
      assert.equal(callParts.length, 1, "legacy call should survive")
      assert.equal(resultParts.length, 1, "legacy result should survive")
    })

    it("removes orphan legacy format result (no matching call)", () => {
      const orphanLegacy: RuntimePart = {
        type: "tool",
        tool_use_id: "legacy-orphan"
      }
      const msgs = [
        assistantMsg("a1", [orphanLegacy]),
        userMsg("u1"),
        assistantMsg("a2"),
      ]
      const result = trimMessages([...msgs], 5, 5, 5, 2, 30)
      const a1 = result.find(m => m.info.id === "a1")
      if (a1) {
        const toolParts = (a1.parts ?? []).filter(
          p => (p as Record<string, unknown>).tool_use_id === "legacy-orphan"
        )
        assert.equal(toolParts.length, 0, "orphan legacy result should be removed")
      }
    })

    it("pure function does not mutate input messages", () => {
      const msgs = [
        assistantMsg("a1", [toolCallPart("tc1")]),
        userMsg("u1"),
        assistantMsg("a2", [toolResultPart("tc1")]),
      ]
      const originalParts = msgs.map(m => [...(m.parts ?? [])])
      trimMessages([...msgs], 5, 5, 5, 2, 30)
      for (let i = 0; i < msgs.length; i++) {
        const origLen = originalParts[i].length
        const nowLen = (msgs[i].parts ?? []).length
        assert.equal(nowLen, origLen,
          `input message ${msgs[i].info.id} was mutated: parts ${origLen} → ${nowLen}`
        )
      }
    })

    it("mutates array in place via splice (not reassignment)", () => {
      const msgs = userAsstPairs(8) // 16 messages
      const result = trimMessages([...msgs], 5, 10, 7, 5, 30)

      // Simulate what the plugin does: splice in-place
      const output = { messages: [...msgs] }
      output.messages.splice(0, output.messages.length, ...result)

      // Verify the array reference is preserved (splice mutates, not replaces)
      assert.equal(output.messages.length, result.length)
    })
  })
})
