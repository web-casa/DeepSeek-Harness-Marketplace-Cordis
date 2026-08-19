# Self-review — CI

## Scope

- `.github/workflows/ci.yml`
- Root `packageManager` pin and pnpm build-script approval

## Reproducibility and supply-chain checks

- The workflow pins Node 24.18.0, pnpm 11.10.0, and the locally proven DSH CLI
  `@deepseek-ai/dsh@0.1.0-rc.7`. The official npm registry query confirms that exact
  version and its published integrity.
- GitHub Actions are full-commit pins obtained from the respective official upstream
  tags, rather than mutable major tags.
- `pnpm install --frozen-lockfile` is used in both jobs. `allowBuilds.esbuild: true`
  was produced by `pnpm approve-builds esbuild`; it grants only the declared Web build
  tool's required postinstall and does not globally enable dependency scripts.
- The jobs need no secrets and have read-only repository permissions. Concurrency only
  cancels superseded work for the same workflow/ref.

## Safety checks

- The host smoke verifies that mutation requests without an Origin or token remain
  rejected. The DSH E2E runs in a temporary profile and retains the existing inspect →
  pre-disable → install → verify → pending → explicit activate → restart sequence.
- DSH CI defaults to the checked-in local fixture. It makes no production cordis.run
  mutation or availability claim; the external API probe remains a separate explicit
  deployment gate.

## Verification

- `actionlint .github/workflows/ci.yml` — passed.
- `CI=true pnpm install --frozen-lockfile` — passed after the explicit esbuild approval.
- `pnpm -r test` — 151 passed.
- `node apps/web/scripts/build.mjs` — passed.
- `node scripts/host-smoke.mjs` — passed.
- `dsh --version` — `0.1.0-rc.7`.
- `node scripts/dsh-smoke.mjs` — passed.
- `node scripts/dsh-e2e-install.mjs` — passed (pending activation, explicit activation,
  restart, target route 200).

## Residual boundary

This checkout has no production cordis.run deployment configuration. GitHub Actions will
verify the fixture-backed integration path, while `scripts/cordis-run-contract-probe.mjs`
must be invoked explicitly against a live deployment once one exists.
