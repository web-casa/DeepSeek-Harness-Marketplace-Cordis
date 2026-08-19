# cordis.run API Rollout Handoff

## Current verified status

On 2026-08-19, the production list and detail endpoints returned Next.js
`404 text/html`, not the v4 JSON contract. The earlier inventory was incomplete:
the cordis.run backend is the parent repository
`/home/ivmm/daohang/toolso-ai-open`, not the nested `cordis-mp` workspace.

The parent now contains the strict v4 routes, registry-artifact persistence and
sync, direct verified preset download, route/unit tests, a successful production
build, and a local real-Next/temporary-PostgreSQL contract probe. No production
deployment was performed in this checkout, so this is **not** a production API
or production-API E2E pass.

## Remaining rollout operator work

Deploy the routes in
[`cordis-run-api-contract.md`](./cordis-run-api-contract.md) without a Next.js
HTML fallback. The detailed parent-repository procedure is
[`../docs/CORDIS-API-V4.md`](../../docs/CORDIS-API-V4.md):

- `GET /api/v1/plugins` supports q/category/platform/sort/order/cursor/limit,
  plus temporary `page/per_page` compatibility; returns JSON `count + page`.
- `GET /api/v1/plugins/{slug}` returns detail JSON, canonical CDN screenshots,
  versions, and JSON 404 errors.
- List/detail 200 responses emit ETag and honor `If-None-Match` with 304.
- npm sources publish exact version/integrity/registry/tarball values, with the
  tarball host equal to the approved registry host.
- preset download is direct `200 application/zip` from `cordis.run`, not a 302.

The operator must apply the nullable `plugin_meta.registry_artifact` column before
deploying the route, backfill it through the existing controlled npm syncer, then
run the probe below. Incomplete registry/GitHub-only records are intentionally
omitted rather than guessed into installable API rows.

## Non-mutating deployment gate

After deployment, run the contract gate against the exact target (test first):

```bash
CORDIS_RUN_API=https://<target>/api/v1 \
  node scripts/cordis-run-contract-probe.mjs
```

It verifies all-platform/web/desktop list responses, JSON content type, v4
wire shape, ETag/304, cursor follow-up when needed, detail screenshots/versions,
and JSON 404 behavior. It installs nothing.

## Real DSH E2E switchover

`scripts/dsh-e2e-install.mjs` remains fixture-backed by default so local CI is
deterministic. It now accepts an external catalog explicitly:

```bash
CORDIS_RUN_API=https://<target>/api/v1 \
CORDIS_E2E_SLUG=dsh-market \
CORDIS_E2E_PLUGIN_ROUTE=/dsh-market/registry \
  node scripts/dsh-e2e-install.mjs
```

The target must expose a dedicated, approved E2E plugin whose artifact is safe
to install in a temporary profile and whose route proves it loaded after restart.
The script still checks inspect integrity, pre-disable, `--ignore-scripts`,
lockfile verification, pending activation, explicit activate, and restart.

Do not make a production-network check mandatory in normal CI until the backend
owner supplies a stable test target and its E2E plugin contract. The repository
CI should keep using the local fixture; a scheduled/manual deployment job can
run the commands above after that agreement.
