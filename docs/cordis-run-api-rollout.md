# cordis.run API Rollout Handoff

## Current verified status

The cordis.run backend is the parent repository
`/home/ivmm/daohang/toolso-ai-open`, not the nested `cordis-mp` workspace. It
is deployed. A read-only production check on 2026-08-19 confirmed:

- `GET /api/v1/plugins?platform=desktop&limit=1` returns v1 JSON with ETag;
- a missing detail returns JSON `404 NOT_FOUND` rather than Next.js HTML; and
- `GET /api/presets/code/download` returns direct `200 application/zip` without
  a `Location` header.

The strict install catalog currently has `count=1`: the guarded one-host
cutover retained `webcasa-web` while replacing its source with
`@webcasa/deepseek-harness-marketplace@0.1.1`. The old source count is zero,
so the catalog does not expose two installable market hosts. This proves the
production API structure and preset delivery only; it is **not** a positive
production plugin-install or lifecycle E2E because the sole entry is the
market host and must self-refuse.

## Remaining release and acceptance work

The parent runbook in
[`../docs/CORDIS-API-V4.md`](../../docs/CORDIS-API-V4.md) remains the procedure
for a fresh environment or a future v4 deployment change. Do not rerun schema
migration or synchronization blindly against the already deployed production
service. The remaining acceptance sequence is publish an owner-approved
*independent* artifact, run its registry-only preflight, perform a guarded
normal registry synchronization with an owner-approved category, and then meet
the strict acceptance gates below. Do not rerun the completed market-host
cutover.

The deployed routes provide:

- `GET /api/v1/plugins` supports q/category/platform/sort/order/cursor/limit,
  plus temporary `page/per_page` compatibility; returns JSON `count + page`.
- `GET /api/v1/plugins/{slug}` returns detail JSON, canonical CDN screenshots,
  versions, and JSON 404 errors.
- List/detail 200 responses emit ETag and honor `If-None-Match` with 304.
- npm sources publish exact version/integrity/registry/tarball values, with the
  tarball host equal to the approved registry host.
- preset download is direct `200 application/zip` from `cordis.run`, not a 302.

Incomplete registry/GitHub-only records are intentionally omitted rather than
guessed into installable API rows. A mutable synchronization remains an
owner-authorized production operation; it must use the existing guarded syncer
and an approved Cordis category.

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
CORDIS_E2E_SLUG=<approved-e2e-slug> \
  node scripts/dsh-e2e-install.mjs
```

`CORDIS_E2E_PLUGIN_ROUTE=/<known-plugin-route>` is optional for plugins that
actually expose a local HTTP route. Without it, the script proves the declared
entry ids are disabled before install, survive the pending-state restart,
become active only after the explicit mutation, and remain active through a
fresh DSH startup. The target must be an approved independent plugin whose
artifact is safe to install in a temporary profile. The script still checks
inspect integrity, pre-disable, `--ignore-scripts`, lockfile verification,
durable pending recovery, explicit activate, and restart.

Do not make a production-network check mandatory in normal CI until the backend
owner supplies a stable test target and its E2E plugin contract. The repository
CI should keep using the local fixture; a scheduled/manual deployment job can
run the commands above after that agreement.
