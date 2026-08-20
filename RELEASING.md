# Releasing

Releases are published to npm by `.github/workflows/publish.yml` using GitHub OIDC trusted publishing. Do not add an npm token to the repository.

## Prerequisites

- Start from an up-to-date `main` branch.
- The npm package's trusted publisher must point to `perbellinioa/pi-copilot-model-discovery` and `publish.yml`.
- Traditional npm tokens should remain disallowed for publishing.
- Node 22, Node 24, and CodeQL checks must pass.

## Prepare the release

Create a branch and choose the appropriate semantic version increment:

```bash
git switch main
git pull --ff-only
git switch -c release/v0.1.1
npm version patch --no-git-tag-version
```

Use `minor` or `major` instead of `patch` when appropriate. Update the README, benchmarks, provider-shaped fixtures, and release notes for user-visible changes.

Validate exactly what will ship:

```bash
npm ci --ignore-scripts
npm run validate
npm audit --omit=dev --audit-level=high
npm pack --dry-run
```

Commit, push, and open a pull request. Merge only after all required checks pass.

## Publish

After merging, confirm `main` contains the intended version:

```bash
git switch main
git pull --ff-only
node --print "require('./package.json').version"
```

Create a GitHub release with a tag that exactly matches `v` plus the package version, for example `v0.1.1`. The release event triggers the trusted publisher workflow.

```bash
gh release create v0.1.1 \
  --repo perbellinioa/pi-copilot-model-discovery \
  --target main \
  --title v0.1.1 \
  --generate-notes
```

The workflow verifies the tag, installs without lifecycle scripts, runs validation, and executes:

```bash
npm publish --access public --provenance
```

## Verify

```bash
npm view pi-copilot-model-discovery version dist-tags dist.attestations --json
```

Then test an isolated pi installation or update the normal installation:

```bash
pi install npm:pi-copilot-model-discovery
# or, when already installed
pi update --extensions
```

Confirm `/copilot-models-status` reports a usable catalog and the expected version appears on npm and the GitHub release page.

## Failure handling

npm versions are immutable and must never be overwritten.

- If the workflow fails before npm publication, fix the issue through a pull request. Delete and recreate the GitHub release/tag only when the version is confirmed absent from npm.
- If npm publication succeeded but later verification fails, publish a corrected patch version.
- Deprecate a broken version rather than attempting to reuse it.
