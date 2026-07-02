# History Trimmer

**Every API call to an LLM carries your entire conversation history — including messages from 50 exchanges ago. You pay for every one of those tokens. Most of them are irrelevant to what you're asking right now.**

This is not an OpenCode problem. This is not a Claude Code problem. This is not a Codex problem. **This is how every API-based LLM works** — the full history goes with every request. The bigger the model, the more expensive the waste.

This plugin solves that at the root: **cap history at N messages per call, discard the rest before the request leaves your machine.** Works on any system that calls an LLM API. Zero impact on quality. Immediate token savings.

> OpenCode users: copy to `plugins/` and restart. Everyone else: adapt the same principle — the hook is `experimental.chat.messages.transform`, the idea is universal.

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

## What you save

History grows every call. Without a cap, a 50-call session sends **~100,000 tokens of conversation the model has already seen**. With the trimmer, history stays flat at ~3,000 tok — no matter how long you chat.

| | 10 calls | 20 calls | 50 calls |
|:--|:--:|:--:|:--:|
| **Without trimmer** — history sent | ~20,000 tok | ~40,000 tok | ~100,000+ tok |
| **With trimmer** — history sent | **~3,000 tok** | **~3,000 tok** | **~3,000 tok** |
| **Waste avoided** | **~17,000 tok** | **~37,000 tok** | **~97,000+ tok** |

That waste is sent **on every call** — it compounds. The trimmer eliminates it in one shot.

### Savings by model

Pricing as of **2 Jul 2026** (cache-miss input). Multiply by your session volume.

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

The math scales with your setup. More MCP servers, more skills, bigger instruction files → bigger base prompt → more tokens saved per call.

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

- **System messages** (instructions, context) — always kept
- **User messages** — keeps up to 3 most recent (your questions are the conversation)
- **Assistant + tool messages** — kept alongside their user message, but trimmed first if total exceeds cap
- The rest are discarded before the HTTPS request to the LLM provider

---

## Configuration

| Variable | Default | Description |
|:---------|:-------:|:------------|
| `MAX_USER_MSGS` | `3` | Max user messages to keep (your questions are prioritized) |
| `HISTORY_KEEP` | `6` | Hard cap on total non-system messages |

```bash
export MAX_USER_MSGS=5     # Keep 5 user questions instead of 3
export HISTORY_KEEP=10     # Raise hard cap for long agentic sessions
```

**Default (3 user + 6 total):** keeps your last 3 questions + their responses. Tool-heavy exchanges that exceed 6 total slots will trim assistant/tool messages before user messages — your questions are never the first to go.

---

## Compatibility

- OpenCode v1.16+
- Uses `experimental.chat.messages.transform` hook
- Works with any LLM provider (no provider-specific behavior)
- Zero dependencies — one TypeScript file

---

## License

MIT
