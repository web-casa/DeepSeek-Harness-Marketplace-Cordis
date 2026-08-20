# Self-review — single-package registry preflight

> Identity correction: all `@webcasa/web@0.1.0` execution results below are historical registry
> evidence. The current unpublished target is `@webcasa/deepseek-harness-marketplace@0.1.1` and must
> independently pass this same exact-package preflight before any owner-approved production sync.

## Scope

- Parent repository `scripts/plugins/sync-npm.ts`
- Parent registry sync helpers and unit tests
- Parent `docs/CORDIS-API-V4.md`
- This release handoff documentation

## Findings fixed

- `--pkg=<package> --dry-run` previously skipped the parsed `dryRun` flag and
  invoked `syncOne`, so a command that appeared read-only could mutate the
  database/R2 path.  It now has a separate pure command plan and registry-only
  preflight path.
- The previous one-package path silently chose `dev-assistant` and ignored
  `--no-assets`.  Mutable single-package execution now requires an explicit,
  configured Cordis category and forwards the requested asset setting.
- An unknown but syntactically valid category could otherwise reach category
  initialization.  It now fails before calling the mutation-capable syncer.
- `dsh.bundle` snapshot validation no longer trusts a stale root-level packument
  field when an npm latest tag exists; it requires that exact latest version
  record.  Direct GitHub manifests without a dist-tag keep their existing
  fallback behavior.

## Security and correctness review

- The preflight validates exact package-name equality and reuses the existing
  strict registry-artifact verifier for canonical SHA-512, registry/tarball,
  platforms, and engine checks.  It contains no SQL construction, shell
  interpolation, publish/tag operation, or DSH installation mutation.
- The CLI's actual mutation remains the established `syncOne` path; this change
  does not change its transaction, security-status behavior, API filtering,
  journal semantics, or guarded DSH lifecycle.
- A preflight failure exits nonzero.  `dshmarket` was deliberately rejected in
  the real read-only CLI test because its current published latest metadata lacks
  strict platform/engine evidence.  That rejection is the intended fail-closed
  result, not a production synchronization attempt.

## Verification

- Targeted Vitest: 9/9 passed (`single-package-command`, exact-latest bundle,
  and category-definition tests).
- Real CLI negative-path harness with an intentionally unreachable
  `DATABASE_URL`: preflight selected its read-only path and rejected the
  incomplete artifact; missing `--category` failed before sync; no database
  connection attempt was observed.
- Parent `pnpm test:unit`: 363/363 passed.
- Parent `pnpm build`: passed.
- Nested `cordis-mp`: 161/161 workspace tests, pack check, host smoke, DSH
  smoke, and real inspect → pre-disable → install → verify → pending → explicit
  activate → restart E2E passed.

## Residual boundary

Execution update (2026-08-20): `@webcasa/web@0.1.0` is public in npm, its exact
registry artifact passed this preflight, and the approved `dev-assistant` sync
created a production catalog entry. The target contract probe observed `count=1`.
The direct bootstrap is not OIDC provenance. A `0.1.1` safety candidate is still
unpublished and must repeat preflight/sync after its Trusted Publishing release.
Real positive production DSH/Desktop E2E, Store allowlist review, and Windows
hosted-CI evidence remain owner/operator gates and are not claimed complete here.
