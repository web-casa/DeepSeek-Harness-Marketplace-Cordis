# Self-review — Web market UI

## Scope

- `apps/web/src/client/MarketSection.js`
- `apps/web/src/client/api.js`
- `apps/web/src/client/market-controller.js`
- Web client tests and generated client bundle

## Safety and contract checks

- The component performs no direct HTTP mutation. Install and explicit activation still call
  the existing controller, whose API client obtains the existing mutation token and uses the
  existing guard-backed host routes.
- No journal, install-core, inspect-core, DSH runner, or host guard behavior changed. The
  required inspect → pre-disable → install → verify → pending → explicit activate sequence
  remains the path exercised by the real DSH E2E.
- Blocked, deprecated, and non-Web items remain browsable but are not installable in the Web UI.
- Detail screenshots are accepted only from HTTPS `cdn.cordis.run`, even if an unexpected
  controller response bypasses catalog-core normalization; images use `referrerPolicy=no-referrer`.
- External project links accept HTTPS only and use `target=_blank` with `rel=noreferrer`.
- API errors preserve code, HTTP status, request ID, and retry-after metadata; the UI exposes
  it in a closed-by-default diagnostic details panel rather than hiding the actionable failure.

## Behavior and accessibility checks

- Pagination forwards opaque cursor/limit values and keeps cursor history rather than deriving
  numeric cursors; page navigation is disabled while loading or at either boundary.
- Detail and list requests carry monotonically increasing request IDs, so a slower stale response
  cannot overwrite a newer search or detail selection.
- The dialog, error panel, pagination navigation, form controls, badges, empty states, and image
  alt text are semantic/labelled. Module-level components avoid per-render component definitions.

## Verification

- `pnpm --filter @cordis-mp/web test` — 9 passed.
- `pnpm -r test` — 151 passed.
- `node apps/web/scripts/build.mjs` — passed.
- `node scripts/dsh-smoke.mjs` — passed.
- `node scripts/dsh-e2e-install.mjs` — passed (install → pending → explicit activate → restart).

## Residual boundary

The production `cordis.run` API remains unverified/unavailable (the 2026-08-19 direct list and
detail probes returned 404 HTML). This UI slice is tested against the contract-aligned local
fixture and does not claim a production API rollout.
