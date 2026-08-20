# cordis.run API Rollout Handoff

## Current verified status

The cordis.run backend is the parent repository
`/home/ivmm/daohang/toolso-ai-open`, not the nested `cordis-mp` workspace. It
is deployed. The current read-only production check on 2026-08-20 confirms:

- `GET /api/v1/plugins?platform=desktop&limit=1` returns v1 JSON with ETag;
- a missing detail returns JSON `404 NOT_FOUND` rather than Next.js HTML; and
- `GET /api/presets/code/download` returns direct `200 application/zip` without
  a `Location` header.

The strict install catalog currently has `count=2`. The guarded one-host
cutover retained `webcasa-web` while replacing its source with
`@webcasa/deepseek-harness-marketplace@0.1.1`; the old source count remains
zero, so the catalog does not expose two installable market hosts. The second,
independent entry is `dsh-plugin-pkgseek@0.1.1`, published public, checked by
the strict registry-only preflight, and synchronized through the guarded
`dev-assistant` path. Its production detail has the expected canonical npm
tarball and SHA-512 integrity.

Positive production lifecycle acceptance is complete and deliberately kept
separate from the market-host self-refusal check:

- the real DSH E2E installed PkgSeek into a temporary profile and proved
  inspect, pre-disable, scripts-disabled install, integrity verification,
  pending recovery across restart, explicit activation, and active state after
  a second restart; and
- Desktop commit
  [`6279a96`](https://github.com/web-casa/DeepSeek-Harness-Desktop/commit/6279a96)
  adds a manually opt-in, production bootstrap-IPC E2E against the same entry.
  It asserts stale revision refusal before mutation, pending receipt/lockfile
  proof, explicit activation, and active state after a real Harness restart in
  a disposable `DSH_HOME`.

The Desktop test is a web-distribution IPC lifecycle test, not a Microsoft
Store install test. It does not modify the Store allowlist.

## Future release and maintenance work

The parent runbook in
[`../docs/CORDIS-API-V4.md`](../../docs/CORDIS-API-V4.md) remains the procedure
for a fresh environment or a future v4 deployment change. Do not rerun schema
migration or synchronization blindly against the already deployed production
service. Do not rerun schema migration, the completed market-host cutover, or
the ordinary PkgSeek synchronization blindly. A later independent artifact or
source replacement needs its own owner confirmation, exact registry proof,
approved category, and the same acceptance gates below.

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

The recorded production command used the independent entry without inventing a
local route:

```bash
CORDIS_RUN_API=https://cordis.run/api/v1 \
CORDIS_E2E_SLUG=dsh-plugin-pkgseek \
CORDIS_E2E_PLUGIN_ROUTE='' \
  node scripts/dsh-e2e-install.mjs
```

This is an authorized manual lifecycle mutation against an isolated profile;
it is evidence for the production state at the time of execution, not a normal
CI dependency or permission to bypass the harness mutation guard.

Do not make the production-network check mandatory in normal CI even though
the reviewed PkgSeek target now exists: ordinary CI must remain deterministic
and must not create an ambient production mutation dependency. The repository
CI keeps using the local fixture; an explicitly authorized manual or deployment
acceptance run may execute the commands above.
