# cordis.run API Rollout Handoff

## Current verified status

On 2026-08-19, direct reads of production list and detail endpoints returned
Next.js `404 text/html`, not the v4 JSON contract. The cordis.run backend is not
part of this repository, so this checkout cannot deploy that missing service and
must not claim a production API or production-API E2E pass.

## Backend owner deliverables

Deploy the routes in
[`cordis-run-api-contract.md`](./cordis-run-api-contract.md) without a Next.js
HTML fallback:

- `GET /api/v1/plugins` supports q/category/platform/sort/order/cursor/limit,
  plus temporary `page/per_page` compatibility; returns JSON `count + page`.
- `GET /api/v1/plugins/{slug}` returns detail JSON, canonical CDN screenshots,
  versions, and JSON 404 errors.
- List/detail 200 responses emit ETag and honor `If-None-Match` with 304.
- npm sources publish exact version/integrity/registry/tarball values, with the
  tarball host equal to the approved registry host.
- preset download is direct `200 application/zip` from `cordis.run`, not a 302.

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
