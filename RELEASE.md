# cordis-mp release preparation

## Current release candidate

- Version: `0.1.0` (root, six core workspaces, and `@cordis-mp/web` are aligned).
- Status: packaging preflight is ready; no npm publication, tag, or visibility change has
  been performed.
- Package policy: every workspace is currently `private: true`. Keep that protection until
  the package owner explicitly decides which packages, scope, license, maintainers, and
  provenance policy are public.

## Artifact boundary

`@cordis-mp/web` is the DSH plugin deliverable. Its normal workspace manifest contains
`workspace:*` dependencies, so a raw npm tarball is useful for metadata inspection but is
not a standalone public install artifact. Use the existing self-contained DSH packer:

```bash
node apps/web/scripts/build.mjs
node apps/web/scripts/pack-smoke.mjs
```

The second command prints a temporary `.tgz` path. `node scripts/dsh-smoke.mjs` and
`node scripts/dsh-e2e-install.mjs` install that exact artifact into an isolated DSH profile.

## Release preflight

```bash
CI=true pnpm install --frozen-lockfile
pnpm -r test
node apps/web/scripts/build.mjs
pnpm run pack:check
node scripts/host-smoke.mjs
node scripts/dsh-smoke.mjs
node scripts/dsh-e2e-install.mjs
```

`pnpm run pack:check` runs `npm pack --dry-run --ignore-scripts --json` for each workspace
candidate. It checks aligned name/version metadata, nonempty file lists, and that ignored
implementation directories are absent; it writes no tarball and runs no package scripts.

## Before a public npm release

Do not remove `private: true`, run `npm publish`, or create a release tag until the owner has
approved all of the following:

1. Public package set and dependency publication order (three packages currently use
   `workspace:*` dependencies).
2. Per-package README, license, ownership/access, npm provenance, and registry policy.
3. A release version if it is not `0.1.0`; update all aligned manifests intentionally and rerun
   the full preflight.
4. The cordis.run production API rollout gate in the parent repository's
   `docs/CORDIS-API-V4.md`. The code is implemented but not deployed; fixture/local E2E is
   not evidence of a production API release. A dedicated approved E2E plugin is required
   for the target-network lifecycle check.

After approval and a clean preflight, create an annotated tag such as `v0.1.0` from the
reviewed commit. Publishing remains a separate owner-authorized action.

## Release-note template

```md
## 0.1.0 — YYYY-MM-DD

### Added
- Contract-ready catalog client, guarded Web harness, DSH runner, inspection gate, and staged activation flow.
- Market details, trusted screenshots, cursor pagination, platform badges, and actionable errors.

### Safety
- Install lifecycle remains inspect → pre-disable → install → verify → pending → explicit activate.
- `verifyInstalled` confirms the pnpm lockfile integrity for the exact installed artifact.

### Validation
- Workspace tests, host smoke, DSH smoke, and DSH install/activate/restart E2E passed.

### Known boundary
- Production cordis.run API deployment, snapshot backfill, target probe, and dedicated
  E2E-plugin validation remain externally pending. Desktop v4 migration is reported complete
  on `feat/cordis-v4-desktop`, but is outside this checkout and needs target smoke after push.
```
