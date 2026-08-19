# pi-copilot-model-discovery

Lean, provider-driven GitHub Copilot model discovery for [pi](https://github.com/earendil-works/pi-mono).

The package replaces pi's static Copilot model list with the authenticated tenant's live `/models` catalog while preserving pi's built-in authentication, token refresh, enterprise endpoint resolution, request transport, and streaming implementations.

## Principles

- The provider response is the source of truth.
- No model IDs, names, vendors, or families are used for routing or capabilities.
- No reasoning levels are invented or aliased.
- Unknown or malformed models are skipped with diagnostics rather than guessed.
- Pi's built-in catalog remains available as the first-run and offline fallback.
- A credential-partitioned raw catalog cache provides immediate subsequent startup.
- Fresh caches avoid the network; stale caches use ETag/Last-Modified revalidation.

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

### Availability filtering

The authenticated live catalog is authoritative for model availability. Entries explicitly marked with `model_picker_enabled: false` or `policy.state: disabled` are excluded. The extension intentionally does not reapply pi's built-in static model-ID filter afterward, because doing so would hide newly discovered tenant models that are not yet present in pi's bundled catalog.

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

A refresh failure retains the previous cached or live catalog. Before the first successful refresh, pi's built-in Copilot catalog remains active.

The raw catalog cache is stored under:

```text
~/.pi/agent/cache/pi-copilot-model-discovery/
```

Cache filenames contain a truncated SHA-256 partition key; credentials are never stored. Cache files use mode `0600`. The default freshness interval is five minutes. Cached startup is immediate, with stale revalidation performed in the background.

This package intentionally uses a namespaced cache instead of pi's provider-ID-keyed model store. A single provider ID can serve multiple Copilot accounts or enterprise tenants; credential partitioning prevents one account's cached catalog from being shown after switching to another.

## Development

```bash
npm install
npm run validate
npm run benchmark
```

Tests use provider-shaped fixtures for Claude Opus/Sonnet, GPT-5.6, Grok, and MAI. They cover direct routing/reasoning conversion, atomic cache persistence, credential partitioning, fresh-cache network avoidance, conditional `304` revalidation, failed-network fallback, and malformed catalogs. See [BENCHMARKS.md](BENCHMARKS.md) for measured baselines.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) for development expectations. Report vulnerabilities according to [SECURITY.md](SECURITY.md), not through public issues.

## License

MIT
