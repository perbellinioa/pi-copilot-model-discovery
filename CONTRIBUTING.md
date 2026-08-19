# Contributing

Thanks for improving `pi-copilot-model-discovery`.

## Development setup

Requirements: Node.js 22.19 or newer and npm 11.

```bash
npm ci
npm run validate
npm run benchmark
```

## Design constraints

- The authenticated Copilot `/models` response is the source of truth.
- Never route or infer capabilities from model IDs, names, vendors, or families.
- Convert only explicitly advertised endpoints, limits, inputs, and reasoning efforts.
- Skip malformed or unsupported records rather than guessing.
- Preserve pi's built-in Copilot authentication, enterprise endpoint resolution, and streaming.
- Keep cache entries credential-partitioned, sanitized, atomic, and free of credentials.
- Retain the built-in catalog when live discovery or revalidation fails.

## Pull requests

- Keep changes focused.
- Add provider-shaped fixtures for catalog behavior changes.
- Run `npm run validate` before submitting.
- Run `npm run benchmark` for conversion-path changes and document meaningful regressions or improvements.
- Do not commit credentials, auth files, tenant catalog captures, session files, or cache files.
- Provider-data examples must be sanitized and reduced to the fields required by the test.
