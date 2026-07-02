# OpenCode History Trimmer Plugin

Caps conversation history to **N messages per API call** — saves tokens by not sending the entire session history every time.

## Why

OpenCode sends the full conversation history with every API call. Over a long session, history can grow to 100+ messages, most of which the model doesn't need to re-read. This plugin trims it client-side before the request goes out.

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
# Keep 10 messages instead of default 6
export HISTORY_KEEP=10

# Windows
$env:HISTORY_KEEP = "10"
```

| Default | Description |
|:-------:|:------------|
| `3` | current exchange + 1 previous (light context — use skills/docs for long-term memory) |

## Compatibility

- OpenCode v1.16+
- Uses `experimental.chat.messages.transform` hook
- Safe to use with any LLM provider (no provider-specific behavior)

## License

MIT
