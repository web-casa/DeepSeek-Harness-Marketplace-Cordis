# Self Review — Catalog Contract Readiness and Desktop Handoff

## Scope

- cursor/ETag/category fixture behavior and fixture integration coverage;
- `catalog-core` page normalization and screenshot source enforcement;
- non-mutating production contract probe and explicit external-API E2E switch;
- Desktop DTO handoff guide.

## Safety review

- No journal-core, activation port, install ordering, or mutation guard changed.
- The contract probe performs only GET requests and requires an explicit
  `CORDIS_RUN_API`; it cannot silently target production or perform installs.
- Normal E2E remains local-fixture backed. An external target is opt-in and
  still uses a temporary DSH profile, `--ignore-scripts`, inspect, pre-disable,
  lockfile verification, pending activation, and explicit activate.
- Detail screenshots are retained only for `https://cdn.cordis.run/`, matching
  the API contract and avoiding arbitrary image-origin propagation to the UI.
- Unsupported/invalid cursors return JSON `BAD_CURSOR` in the fixture; a null
  end cursor is preserved instead of fabricated as an empty string.

## Correctness and test evidence

- `pnpm --filter @cordis-mp/catalog-core test` — 7/7 pass, including opaque
  cursor, `page/per_page`, category, ETag/304, safe screenshot, JSON error,
  and the deployment probe against the fixture.
- `pnpm --filter @cordis-mp/web-harness test` — 14/14 pass, including cursor
  and limit forwarding without accidental legacy pagination parameters.
- `node scripts/dsh-e2e-install.mjs` — default fixture real DSH E2E pass.
- Explicit external-API path was separately run against a local fixture with
  `CORDIS_RUN_API=...`; it logged `external` and completed the same lifecycle.
- `pnpm -r test` — 150/150 pass.

## Result

No critical, high, or merge-blocking issue found in the reviewed scope. The
Desktop guide is intentionally a handoff rather than a false implementation
claim because this repository contains no Desktop source tree.

## Residual boundary

At the time of this review the production host returned 404 HTML. The parent
repository now contains the backend implementation, but deployment, a stable
public E2E test plugin, and target-network validation remain operator work; see
`docs/cordis-run-api-rollout.md`. Desktop v4 migration is now reported complete
on `feat/cordis-v4-desktop`, but remains outside this checkout and has not been
independently retested here.
