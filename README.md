# pi-copilot-model-discovery

Lean, provider-driven GitHub Copilot model discovery for [pi](https://github.com/earendil-works/pi-mono).

The package replaces pi's static Copilot model list with the authenticated tenant's live `/models` catalog while preserving pi's built-in authentication, token refresh, enterprise endpoint resolution, request transport, and streaming implementations.

## Principles

- The provider response is the source of truth.
- No model IDs, names, vendors, or families are used for routing or capabilities.
- No reasoning levels are invented or aliased.
- Unknown or malformed models are skipped with diagnostics rather than guessed.
- Pi's built-in catalog remains available as the offline/startup fallback.

## Mapping

Only protocol and schema adaptation is performed:

| Copilot data | pi data |
| --- | --- |
| `/v1/messages` | `anthropic-messages` |
| `/responses` or `ws:/responses` | `openai-responses` |
| `/chat/completions` | `openai-completions` |
| `reasoning_effort: none` | `thinkingLevelMap.off` |
| `low`, `medium`, `high`, `xhigh`, `max` | Identical pi reasoning levels |
| `supports.vision` | Text/image input support |
| `supports.adaptive_thinking` | Anthropic adaptive-thinking compatibility |
| Provider token limits | Context and output limits |

`minimal` is unsupported unless the provider explicitly returns it.

Grok and MAI require no special cases: their current catalog entries advertise `/responses`, so they automatically use pi's OpenAI Responses transport.

## Requirements

- pi 0.84 or newer
- Node.js 22.19 or newer
- GitHub Copilot authentication configured through pi

## Install

From npm after publication:

```bash
pi install npm:pi-copilot-model-discovery
```

From GitHub:

```bash
pi install git:github.com/perbellinioa/pi-copilot-model-discovery
```

For local development:

```bash
pi install /absolute/path/to/pi-copilot-model-discovery
```

Then run `/reload` in an existing session.

## Commands

```text
/copilot-models-refresh  Re-fetch the authenticated live model catalog
/copilot-models-status   Show catalog source, model count, and refresh errors
```

A refresh failure retains the previous live catalog. Before the first successful refresh, pi's built-in Copilot catalog remains active.

## Development

```bash
npm install
npm run validate
```

Tests use provider-shaped fixtures for Claude Opus/Sonnet, GPT-5.6, Grok, and MAI. They assert that endpoint routing and reasoning values come directly from catalog fields.

## License

MIT
