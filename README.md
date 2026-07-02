# OpenCode History Trimmer Plugin

Every time you hit enter, your entire conversation history — including messages from 50 exchanges ago — gets packed up and sent to the API. **You pay for every single one of those tokens.** Most of them are irrelevant to what you're asking right now.

This plugin caps history at **N messages per call** — the rest are discarded before the request leaves your machine. Zero impact on quality. Immediate token savings.

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
- **Non-system messages** (user, assistant, tool results) — only the last N are kept
- The rest are discarded before the HTTPS request to the LLM provider

---

## Configuration

| Variable | Default | Description |
|:---------|:-------:|:------------|
| `HISTORY_KEEP` | `6` | Number of non-system messages to keep per call |

```bash
export HISTORY_KEEP=10     # Keep 10 for long agentic sessions
```

**6 messages** (~2 exchanges) is the default — safe for normal use, including multi-tool calls. Raise it for deep agentic sessions, lower it to 3 if you're aggressively optimizing.

---

## Compatibility

- OpenCode v1.16+
- Uses `experimental.chat.messages.transform` hook
- Works with any LLM provider (no provider-specific behavior)
- Zero dependencies — one TypeScript file

---

## License

MIT
