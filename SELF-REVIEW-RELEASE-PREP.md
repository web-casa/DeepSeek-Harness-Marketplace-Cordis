# Self-review — release preparation

## Scope

- `scripts/npm-pack-check.mjs` and root `pack:check` script
- Release documentation and CI pack metadata step

## Checks

- The pack preflight delegates to the existing `npm pack` CLI with `--dry-run`,
  `--ignore-scripts`, and `--json`; it creates no tarball and cannot execute package scripts.
- It uses a fixed workspace directory list, parses npm's returned metadata, verifies each
  package's name/version against its manifest and root version, requires a nonempty file list,
  and rejects `node_modules` or `.git` entries. There is no untrusted shell interpolation.
- The report deliberately records `private` and `workspace:*` dependencies rather than hiding
  them. It does not imply that raw workspace tarballs are independently installable or ready for
  npm publication.
- The actual DSH artifact remains the pre-existing self-contained `pack-smoke` tarball. No
  `private` flag, release version, registry configuration, tag, or publish state changed.
- CI runs the metadata check after the Web build; runtime smoke and staged-install E2E remain
  separate, existing checks.

## Verification

- `pnpm run pack:check` — passed for all seven workspace candidates at version `0.1.0`.
- `actionlint .github/workflows/ci.yml` — passed with the added pack check step.
- `node apps/web/scripts/build.mjs && node apps/web/scripts/pack-smoke.mjs` — passed; the
  generated tarball contains only the flattened runtime entrypoints, patch, and snapshot.
- `node scripts/host-smoke.mjs` — passed.
- `node scripts/dsh-e2e-install.mjs` — passed after the release-preparation changes
  (inspect → pending → explicit activate → restart → route 200).

## Residual boundary

Public npm publishing requires an explicit owner decision on package visibility, scope, license,
provenance, and workspace dependency release order. Production cordis.run API deployment remains
an independent external gate.
