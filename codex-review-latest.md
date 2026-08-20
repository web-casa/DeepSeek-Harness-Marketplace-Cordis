# Codex current review — 2026-08-20

This replaces the earlier pre-fix static note. Its reported blockers were
valid at the time, but its file paths and conclusions no longer describe the
current source.

## Resolved review findings

- Pending activation is written in the original install journal transaction.
  Host startup acquires the shared profile lock, runs `journal.recover()`, then
  `recoverPending()` before it mounts any catalog or mutation route. Malformed
  pending state fails startup closed.
- `preDisable` now happens inside the journaled `try` path. Activation records
  only the disable rows this operation changed, so rollback or Activate cannot
  remove an operator's pre-existing `disabled: true` row.
- `adoptExternal` receives the package manager's observed bytes, and the
  journal verifies ownership instead of adopting arbitrary later filesystem
  state. Empty inspected entry-id lists stay empty; catalog advisory ids never
  cause a patch-layer write.
- The HTTP inspector uses a bounded stream pipeline, validates SHA-512 before
  tar inspection, and removes every failed staged artifact. The activation
  port preserves leading comments when it recreates an empty patch document.
- The DSH E2E now checks build/pack child status, always cleans children, and
  restarts while the plugin is still pending. It requires recovered pending
  state before Activate, then verifies the active configuration after another
  DSH startup. Plugins without a local HTTP route use that configuration and
  readiness evidence instead of an invented route.
- The dual stale-lock takeover test now retains each helper's stderr, exit
  status/signal and spawn error in a failure diagnostic. This does not alter
  `FileLock`; it prevents a transient child failure from degrading the POSIX
  FULL race evidence into an unexplained “zero winners” report.

## Current assessment

No new critical or high-severity defect was found in the reviewed Web install
path, journal boundary, inspection path, or E2E script. The POSIX FULL journal
implementation was not changed. The former external acceptance blockers are
now closed with the independent `dsh-plugin-pkgseek@0.1.1` artifact: it was
published, strict-preflighted, synced through the guarded production path, and
used for both positive production DSH and Desktop lifecycle evidence. PkgSeek's
future release path has a separately verified GitHub OIDC Trusted Publisher;
the already published direct-2FA `0.1.1` does not gain retroactive provenance.
The market-host package's future OIDC relationship and Microsoft Store
allowlist authority remain separate owner decisions, not reasons to lower a
gate.

## Final verification

- `pnpm -r test`: 206/206 pass; journal-core remains 97/97 with its original
  POSIX FULL 96-test gate intact.
- `node scripts/host-smoke.mjs`, `node scripts/dsh-smoke.mjs`, and
  `node scripts/dsh-e2e-install.mjs`: pass.
- `CORDIS_E2E_PLUGIN_ROUTE='' node scripts/dsh-e2e-install.mjs`: pass, proving
  the non-host-route external E2E mode does not invent an endpoint.
- `pnpm run pack:check` and `pnpm run release:public-check`: pass.
- `CORDIS_RUN_API=https://cordis.run/api/v1 node scripts/cordis-run-contract-probe.mjs`:
  pass. The separate host self-refusal E2E returns `409 SELF_INSTALL_FORBIDDEN`
  before mutation, as required.
- The current production Desktop API is direct JSON/ETag and has `count=2`:
  the sole market host plus independent `dsh-plugin-pkgseek@0.1.1`. Its exact
  npm integrity, tarball, engines and platforms match the production detail.
- `dsh-plugin-pkgseek@0.1.1` completed the positive production DSH lifecycle
  E2E in an isolated profile: stale-free inspect → pre-disable → scripts-disabled
  install → exact lockfile integrity → pending/restart recovery → explicit
  activate → active/restart. It did not invent a plugin HTTP route.
- Desktop commit
  [`6279a96`](https://github.com/web-casa/DeepSeek-Harness-Desktop/commit/6279a96)
  adds and passes the matching explicitly opted-in Tauri bootstrap-IPC E2E,
  including stale revision rejection before mutation and the same pending/
  activate/restart assertions. It does not exercise or alter a Store build.
- The latest pushed CI evidence, [run 32331107816](https://github.com/web-casa/DeepSeek-Harness-Marketplace-Cordis/actions/runs/32331107816),
  passed its Ubuntu, DSH lifecycle, and native Windows BEST_EFFORT jobs. This
  record is marketplace CI evidence; the new Desktop E2E remains an explicit
  manual production check and is intentionally not a production-network CI dependency.
- `actionlint .github/workflows/ci.yml .github/workflows/publish.yml`,
  `pnpm audit --prod --audit-level=high`, Node syntax checks, and
  `git diff --check`: pass. The supplementary generic style checker has no
  non-naming findings in the new TypeScript E2E; its camelCase warnings are
  Python-oriented false positives, not a request to violate the Desktop
  TypeScript convention.

These commands were run against the final change set before this review is
committed.
