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

## Current assessment

No new critical or high-severity defect was found in the reviewed Web install
path, journal boundary, inspection path, or E2E script. The POSIX FULL journal
implementation was not changed. Remaining work is external acceptance, not a
reason to lower a gate: publish and independently review a non-host plugin,
synchronize it through the guarded production path, run the positive
production DSH/Desktop lifecycle E2E, and complete npm Trusted Publishing's
interactive owner verification before a later OIDC release.

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
- Desktop's read-only `verify:cordis-preset` and `verify:cordis-market` probes
  pass, including `webcasa-web` nested-source wire validation.
- The latest pushed CI evidence, [run 32331107816](https://github.com/web-casa/DeepSeek-Harness-Marketplace-Cordis/actions/runs/32331107816),
  passed its Ubuntu, DSH lifecycle, and native Windows BEST_EFFORT jobs. This
  local commit has not been pushed, so it has not claimed a remote CI run.
- `actionlint .github/workflows/ci.yml .github/workflows/publish.yml`,
  `pnpm audit --prod --audit-level=high`, Node syntax checks, the review style
  checker, and `git diff --check`: pass.

These commands were run against the final change set before this review is
committed.
