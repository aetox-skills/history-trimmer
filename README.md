# History Trimmer

> **v4 — 2 Jul 2026**: critical bug fix (splice in-place mutation), runtime type safety, tool pair integrity always validated, 20 unit tests

**Every API call to an LLM carries your entire conversation history — including messages from 50 exchanges ago. You pay for every one of those tokens. Most of them are irrelevant to what you're asking right now.**

This is not an OpenCode problem. This is not a Claude Code problem. This is not a Codex problem. **This is how every API-based LLM works** — the full history goes with every request. The bigger the model, the more expensive the waste.

This plugin solves that for **OpenCode** by hooking into `experimental.chat.messages.transform` — it caps history at N messages per call before the request leaves your machine. Immediate token savings.

> **Not on OpenCode?** The *principle* is universal — every ADE (Aider, Kilo, Claude Code, Codex, Cursor, ZCode, and so on) has the same problem and some way to cap or compact history. Find your tool's equivalent and apply the same logic: **limit what you send, keep what matters.**

---

## Install in 10 seconds

```bash
# Copy 1 file, restart OpenCode. Done.
cp history-trimmer.ts ~/.config/opencode/plugins/
```

**Windows:**
```powershell
Copy-Item history-trimmer.ts "$env:USERPROFILE\.config\opencode\plugins\"
```

Restart OpenCode → plugins auto-load. No config file, no dependencies, no setup.

---

## When not to use this

History trimming trades deep context for token savings. **In most forward-moving conversations this is a free optimization.** But there are cases where it can hurt:

- **Long architectural planning sessions** — where the model needs to reference constraints discussed 20 messages ago
- **Debug sessions relying on old error logs or tool outputs** — each call builds on the last
- **Agent workflows where previous tool results are still referenced** — if the agent says "as we saw earlier"
- **Legal / medical / financial workflows** — where full trace context is required

For these cases, raise `HISTORY_KEEP` (or disable the plugin entirely) and accept the higher token cost. The trade-off is controlled, not zero.

---

## What you save

History grows every call. Without a cap, a 50-call session sends **~100,000 tokens of conversation the model has already seen**. With the trimmer, history is capped at 10 messages (~5,000 tok) — flat regardless of session length.

| | 10 calls | 20 calls | 50 calls |
|:--|:--:|:--:|:--:|
| **Without trimmer** — history sent | ~20,000 tok | ~40,000 tok | ~100,000+ tok |
| **With trimmer** — history sent | **~5,000 tok** | **~5,000 tok** | **~5,000 tok** |
| **Waste avoided** | **~15,000 tok** | **~35,000 tok** | **~95,000+ tok** |

That waste is sent **on every call** — it compounds. The trimmer eliminates it in one shot.

### Savings by model

Pricing as of **2 Jul 2026** (cache-miss input). Multiply by your session volume.

> **Assumptions:** savings are estimated from cache-miss input rate only. Does not include output tokens, provider cache behavior, or variable pricing. These are **illustrative minimums** — actual savings depend on your model, cache hit rate, and session length.

| Model | Price /M tok | 10 calls | 20 calls | Session (~100K) | **Month** |
|:--|:--:|:--:|:--:|:--:|:--:|
| DeepSeek V4 Flash 🇨🇳 | $0.14 | ~$0.003 | ~$0.006 | ~$0.01 | **~$0.42** |
| DeepSeek V4 Pro 🇨🇳 | $0.435 | ~$0.01 | ~$0.02 | ~$0.04 | **~$1.30** |
| GLM-5 🇨🇳 | $1.00 | ~$0.02 | ~$0.04 | ~$0.10 | **~$3.00** |
| Claude Haiku 4.5 | $1.00 | ~$0.02 | ~$0.04 | ~$0.10 | **~$3.00** |
| Qwen3 Max 🇨🇳 | $1.20 | ~$0.02 | ~$0.05 | ~$0.12 | **~$3.60** |
| GPT-5 | $1.25 | ~$0.03 | ~$0.05 | ~$0.13 | **~$3.75** |
| Gemini 2.5 Pro | $1.25 | ~$0.03 | ~$0.05 | ~$0.13 | **~$3.75** |
| Claude Sonnet 4.5 | $3.00 | ~$0.06 | ~$0.12 | ~$0.30 | **~$9.00** |
| GPT-5.5 | $5.00 | ~$0.10 | ~$0.20 | ~$0.50 | **~$15.00** |
| Claude Opus 4.8 | $5.00 | ~$0.10 | ~$0.20 | ~$0.50 | **~$15.00** |

> **The more expensive your model, the more this plugin pays for itself.**  
> On Opus 4.8 or GPT-5.5: **$15/month** — from a 20-line TypeScript file.

> **This plugin trims conversation history — not system prompts.** System prompt bloat (too many MCP servers, skills, instruction files) lives in a different layer and needs a different strategy: comment out unused MCPs, trim instruction files, shorten skill descriptions. Pair this plugin with [token-saver (RTK)](https://github.com/aetox-skills/token-saver) for command output and [token-calc](https://github.com/aetox-skills/token-calc) to measure what to cut first.

---

## Why this works

### History is not memory

The model can already read the current session — it knows what you just said. And most workflows **move forward** — you don't revisit what you discussed 20 messages ago.

If you use AI as a **personal assistant**, long-term memory belongs in a knowledge base — Obsidian, skills, journal files, project docs — not in API call history. That's where real context lives.

This plugin is optimized for that principle: **keep just enough context for the current exchange, and let skills + docs handle everything else.**

### How it works

```typescript
"experimental.chat.messages.transform" → filters messages array before API call
```

3-step pipeline:

1. **User-priority capped trim** — keeps up to 5 most recent user messages, hard cap at 10 total. Walks from the end of history, counting user messages. Drops everything before the cut point.

2. **Tool call/result pair integrity** — always runs (even on sessions under HARD_CAP). Matches tool calls to results by `toolCallId` (OpenCode runtime format), with fallback support for `callID` (SDK format) and `tool_call_id`/`tool_use_id` (legacy provider format). Orphaned pairs are removed — no broken tool chains sent to the LLM.

3. **In-place mutation via `splice`** — reassigning `output.messages` is a silent no-op in OpenCode (see [issue #25754](https://github.com/anomalyco/opencode/issues/25754)). The plugin mutates the array in place to ensure changes take effect.

- **User messages** — keeps up to 5 most recent (your questions are the conversation)
- **Assistant messages** — kept alongside their user message, trimmed first if total exceeds cap
- **Tool calls/results** — paired by ID, orphaned parts cleaned up regardless of session length
- The rest are discarded before the HTTPS request to the LLM provider

> **Note on runtime format:** The `experimental.chat.messages.transform` hook uses OpenCode's internal message format (from `message.ts`), NOT the SDK `Part` types. Tool calls/results are `ToolInvocationPart` (type `"tool-invocation"`) paired by `toolInvocation.toolCallId`. The plugin handles this format natively while maintaining backward compatibility with SDK and provider field names.

---

## Configuration

| Variable | Default | Description |
|:---------|:-------:|:------------|
| `MAX_USER_MSGS` | `5` | Max user messages to keep (your questions are prioritized) |
| `HISTORY_KEEP` | `10` | Hard cap on total non-system messages |

```bash
export MAX_USER_MSGS=8     # Keep 8 user questions instead of 5
export HISTORY_KEEP=15     # Raise hard cap for deep agentic sessions
```

**Default (5 user + 10 total):** keeps your last 5 questions + their responses. Enough context for natural back-and-forth while still saving ~97% vs uncapped history.

---

## Testing

```bash
npx tsx --test history-trimmer.test.ts
```

**20 tests across 7 suites** covering:
- Basic trimming (cap enforcement, recency)
- User-priority trimming (MAX_USER, HARD_CAP interaction)
- Boundary conditions (HARD_CAP < MAX_USER, consecutive user messages)
- Tool pair integrity (matched pairs preserved, orphaned calls/results removed, empty message cleanup)
- Edge cases (no parts, undefined parts, all-assistant sessions, single message)
- Multi-format compatibility (SDK `callID`, legacy `tool_call_id`/`tool_use_id`)
- In-place mutation behavior (splice vs reassignment)

---

## Compatibility

- OpenCode v1.16+
- Uses `experimental.chat.messages.transform` hook
- Handles OpenCode runtime format (`ToolInvocationPart`) + SDK format (`ToolPart`) + legacy provider format
- Zero dependencies — one TypeScript file + one test file

---

## License

MIT
