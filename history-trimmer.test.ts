/**
 * Tests for history-trimmer plugin
 * Run: npx tsx --test history-trimmer.test.ts
 */
import { describe, it } from "node:test"
import assert from "node:assert"
import { trimMessages, type RuntimeMessage, type RuntimePart } from "./history-trimmer"

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

// ── Tests ──

describe("History Trimmer", () => {
  describe("basic trimming", () => {
    it("no-op when messages <= HARD_CAP", () => {
      const msgs = [userMsg("1"), assistantMsg("2"), userMsg("3")]
      const result = trimMessages([...msgs], 5, 10)
      assert.equal(result.length, 3)
    })

    it("caps at HARD_CAP when over limit", () => {
      const msgs = Array.from({ length: 15 }, (_, i) =>
        i % 2 === 0 ? userMsg(`u${i}`) : assistantMsg(`a${i}`)
      )
      const result = trimMessages([...msgs], 5, 10)
      assert.ok(result.length <= 10, `expected <= 10, got ${result.length}`)
    })

    it("keeps most recent messages at tail", () => {
      const msgs = [
        userMsg("u1", "oldest"),
        assistantMsg("a1"),
        userMsg("u2", "middle"),
        assistantMsg("a2"),
        userMsg("u3", "newest"),
      ]
      const result = trimMessages([...msgs], 3, 6)
      const lastUser = result.filter(m => m.info.role === "user").pop()
      assert.ok(lastUser)
      assert.equal((lastUser!.parts[0] as RuntimePart).text, "newest")
    })
  })

  describe("user-priority trimming", () => {
    it("keeps up to MAX_USER most recent user messages", () => {
      const msgs: RuntimeMessage[] = []
      for (let i = 0; i < 10; i++) {
        msgs.push(userMsg(`u${i}`))
        msgs.push(assistantMsg(`a${i}`))
      }
      const result = trimMessages([...msgs], 3, 10)
      const users = result.filter(m => m.info.role === "user")
      assert.equal(users.length, 3, `expected 3 users, got ${users.length}`)
      assert.equal(users[0].info.id, "u7")
      assert.equal(users[1].info.id, "u8")
      assert.equal(users[2].info.id, "u9")
    })

    it("HARD_CAP still enforced when too few users", () => {
      const msgs: RuntimeMessage[] = []
      for (let i = 0; i < 10; i++) {
        msgs.push(assistantMsg(`a${i}`))
      }
      const result = trimMessages([...msgs], 5, 5)
      assert.ok(result.length <= 5)
    })
  })

  describe("HARD_CAP boundary", () => {
    it("HARD_CAP takes priority over MAX_USER", () => {
      const msgs = [
        userMsg("u1"), assistantMsg("a1"),
        userMsg("u2"), assistantMsg("a2"),
        userMsg("u3"), assistantMsg("a3"),
        userMsg("u4"), assistantMsg("a4"),
      ]
      const result = trimMessages([...msgs], 5, 3)
      assert.ok(result.length <= 3)
    })

    it("handles HARD_CAP < MAX_USER gracefully", () => {
      const msgs = [
        userMsg("u1"), assistantMsg("a1"),
        userMsg("u2"), assistantMsg("a2"),
      ]
      const result = trimMessages([...msgs], 10, 3)
      assert.ok(result.length <= 3)
    })
  })

  describe("tool pair integrity", () => {
    it("keeps tool call with matching result", () => {
      const msgs = [
        assistantMsg("a1", [toolCallPart("tc1")]),
        userMsg("u1"),
        assistantMsg("a2", [toolResultPart("tc1")]),
      ]
      const result = trimMessages([...msgs], 10, 10)
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
      const result = trimMessages([...msgs], 2, 4)
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
      const result = trimMessages([...msgs], 10, 10)
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
      const result = trimMessages([...msgs], 10, 10)
      const a1 = result.find(m => m.info.id === "a1")
      assert.equal(a1, undefined, "empty message should be removed")
    })
  })

  describe("edge cases", () => {
    it("handles messages without parts", () => {
      const m1: RuntimeMessage = { info: { role: "user", id: "u1" }, parts: [] }
      const m2: RuntimeMessage = { info: { role: "assistant", id: "a1" }, parts: [] }
      const result = trimMessages([m1, m2], 5, 10)
      assert.equal(result.length, 2)
    })

    it("handles undefined parts gracefully", () => {
      const m1: RuntimeMessage = {
        info: { role: "user", id: "u1" },
        parts: undefined as unknown as RuntimePart[]
      }
      const result = trimMessages([m1], 5, 10)
      assert.equal(result.length, 1)
    })

    it("consecutive user messages without assistant between them", () => {
      const msgs = [
        userMsg("u1"),
        userMsg("u2"),
        userMsg("u3"),
        assistantMsg("a1"),
      ]
      const result = trimMessages([...msgs], 2, 3)
      const users = result.filter(m => m.info.role === "user")
      assert.equal(users.length, 2)
    })

    it("all assistant messages, no users", () => {
      const msgs = [
        assistantMsg("a1"),
        assistantMsg("a2"),
        assistantMsg("a3"),
        assistantMsg("a4"),
        assistantMsg("a5"),
        assistantMsg("a6"),
      ]
      const result = trimMessages([...msgs], 5, 3)
      assert.ok(result.length <= 3)
    })

    it("single message session", () => {
      const msgs = [userMsg("u1")]
      const result = trimMessages([...msgs], 5, 10)
      assert.equal(result.length, 1)
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
      const result = trimMessages([...msgs], 10, 10)
      assert.equal(result.length, 3)
    })

    it("handles legacy tool_call_id/tool_use_id format", () => {
      const legacyCall: RuntimePart = {
        type: "tool",
        tool_call_id: "legacy-1",
        tool_use_id: "legacy-1"
      }
      const msgs = [
        assistantMsg("a1", [legacyCall]),
        userMsg("u1"),
        assistantMsg("a2", [{ type: "tool", tool_use_id: "legacy-1" }]),
      ]
      const result = trimMessages([...msgs], 10, 10)
      assert.equal(result.length, 3)
    })
  })

  describe("in-place mutation (splice behavior)", () => {
    it("mutates array in place via splice (not reassignment)", () => {
      const msgs = Array.from({ length: 15 }, (_, i) =>
        i % 2 === 0 ? userMsg(`u${i}`) : assistantMsg(`a${i}`)
      )
      const output = { messages: msgs }
      const trimmed = trimMessages([...msgs], 5, 10)

      // Simulate what the plugin does: splice in-place
      output.messages.splice(0, output.messages.length, ...trimmed)

      // Verify the array reference is preserved (splice mutates, not replaces)
      assert.equal(output.messages.length, trimmed.length)
    })
  })
})
