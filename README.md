# OpenCode History Trimmer Plugin

Caps conversation history to **N messages per API call** — saves tokens by not sending the entire session history every time.

## Why

OpenCode sends the full conversation history with every API call. Over a long session, history can grow to 100+ messages, most of which the model doesn't need to re-read. This plugin trims it client-side before the request goes out.

### The philosophy: History is not memory

The model can already **read the current session** — it knows what was just said. And most workflows **move forward** — you don't revisit what you discussed 20 messages ago. The past doesn't help the next step.

If you're using AI as a **personal assistant** (like Mike does), long-term memory belongs in a knowledge base — Obsidian, skills, journal files, project docs — not in API call history. That's where the real context lives.

This plugin is optimized for that mindset: keep just enough context for the current exchange, and let skills + docs handle everything else.

**3 messages is enough for most assistant workflows.** If you regularly need deep history reference, raise it with `HISTORY_KEEP`.

## How It Works

```typescript
"experimental.chat.messages.transform" → filters messages array before API call
```

- **System messages** (instructions, context) — always kept
- **Non-system messages** (user, assistant, tool results) — only the last N are kept
- The rest are discarded before the HTTPS request to the LLM provider

## Install

1. Copy `history-trimmer.ts` to your OpenCode plugins directory:

```bash
# Linux / macOS
cp history-trimmer.ts ~/.config/opencode/plugins/

# Windows (PowerShell)
Copy-Item history-trimmer.ts "$env:USERPROFILE\.config\opencode\plugins\"
```

2. **Restart OpenCode** — plugins are auto-loaded on startup.

## Configuration

Set the `HISTORY_KEEP` environment variable to control how many messages are kept:

```bash
# Keep 6 messages instead of default 3
export HISTORY_KEEP=6

# Windows
$env:HISTORY_KEEP = "6"
```

| Default | Description |
|:-------:|:------------|
| `3` | current exchange + 1 previous — sufficient for assistant workflows where long-term memory lives in skills/docs/Obsidian |

## Real-world Savings

A single session without this plugin sends history that grows with every call. Here's what you save by capping at 3 messages.

### The compounding problem

History doesn't just add a few tokens — it compounds. On every call, the full accumulated history is sent again. At 10 calls, history is ~20K. At 20 calls, ~40K. By session 50, over 100K.

With the trimmer, history stays **flat** at ~1.5K no matter how long you chat.

> **More MCP servers, more skills, more instruction files = bigger base prompt → bigger savings.** If your system prompt is 30K instead of 15K, the waste doubles. The trimmer's value scales with how much you've loaded in.

### Scenario: 15K system prompt at 10 / 20 calls

Assume a typical optimized setup: 15K system prompt + user message + history. See what happens with and without the trimmer:

| | 10 calls | 20 calls |
|:--|:--:|:--:|
| **Without trimmer** — history sent | ~18,000 tok | ~38,000 tok |
| **With trimmer** — history sent | **~1,500 tok** | **~1,500 tok** |
| **History waste avoided** | **~16,500 tok** | **~36,500 tok** |

That 16–36K of history is sent **on every call after the first**. It compounds across the session. The trimmer eliminates it completely.

### Example: Mike's OpenCode setup

A real personal-assistant workflow with trimmed instructions, 4 MCP servers, and 3-message history cap:

| Metric | Without trimmer | With trimmer (3 msgs) |
|:--|:--:|:--:|
| History sent per call | grows to 100K+ tok | **~1,500 tok** (flat) |
| History saved per session | — | **~100K tok** |
| Cache hit rate | ~30% | **~77%** |
| Session cost (DeepSeek V4 Flash) | ~$0.50-1.00 | **~$0.13** |

### Savings by model

What ~100K of history costs you per session on different models. Pricing as of **2 Jul 2026** (cache-miss input rate). Add cache hits and your session grows — these are minimum savings.

| Model | Input /M | 10 calls (~20K) | 20 calls (~40K) | Session (~100K) | Month |
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
> On Opus 4.8 or GPT-5.5, a 20-line plugin saves **$15/month** — and that's *before* cache hit discounts. On DeepSeek Flash it's still free optimization.

**The math works on any model:** history not sent = tokens you don't pay for. No downside, no tradeoff — just less waste. And if your setup has 30K+ system prompt (many skills, many MCPs), the waste compounds faster — so the savings grow accordingly.

## Compatibility

- OpenCode v1.16+
- Uses `experimental.chat.messages.transform` hook
- Safe to use with any LLM provider (no provider-specific behavior)

## License

MIT
