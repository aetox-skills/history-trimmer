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

## Compatibility

- OpenCode v1.16+
- Uses `experimental.chat.messages.transform` hook
- Safe to use with any LLM provider (no provider-specific behavior)

## License

MIT
