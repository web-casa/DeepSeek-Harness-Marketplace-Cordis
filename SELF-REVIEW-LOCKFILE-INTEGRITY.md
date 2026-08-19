# Self Review — Lockfile Integrity Gate

## Scope

- `packages/dsh-runner/src/package-manager.mjs`
- `packages/dsh-runner/test/package-manager.test.mjs`

## What changed

`DshPackageManagerPort.verifyInstalled()` now requires two independent proofs:

1. `node_modules/<package>/package.json` has the catalog package name and exact version.
2. The profile's `pnpm-lock.yaml` has at least one exact package/version record under
   `packages`, and every matching record has the catalog `integrity` value.

The parser supports the observed pnpm v9 inline `resolution` format, plus quoted,
peer-suffixed and nested-resolution records. It reads only a regular lockfile no
larger than 16 MiB. Unknown, missing, malformed, oversized, or mismatched input
returns `false`; it never guesses a successful verification.

## Safety review

- No install, activation, journal, or mutation-guard ordering changed.
- `InstallService` still performs inspect → pre-disable → install with
  `--ignore-scripts` → verify → journal commit → pending activation.
- A failed verification remains on the existing catch/recovery path, so profile
  changes and owned pre-disable rows are rolled back/cancelled rather than activated.
- The parser uses no YAML deserialization or code execution and has no new package
  dependency in the install trust boundary.
- Matching is exact on package name + version, including scoped packages and pnpm
  peer suffixes; it does not accept a merely similar version.

## Evidence

- `pnpm --filter @cordis-mp/dsh-runner test` — 11/11 pass.
- `node scripts/dsh-e2e-install.mjs` — real DSH fixture install, pre-disable,
  lockfile verification, explicit activation, restart, and route check pass.
- `pnpm -r test` — 148/148 pass.

## Result

No critical, high, or merge-blocking issue found after reviewing the parser's
exact-key matching, failure modes, transaction ordering, and generated host
bundle. The review added the missing-lockfile regression assertion before the
final verification run.

## Residual boundary

This gate verifies the lockfile data written by pnpm after the tarball has already
been inspected against catalog integrity. It does not replace the tarball hash
check, and intentionally fails closed for an unsupported future pnpm lockfile
shape until that shape is reviewed and tested.
