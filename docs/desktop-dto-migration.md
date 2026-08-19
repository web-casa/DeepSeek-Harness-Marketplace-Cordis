# Desktop Market DTO Migration Guide

## Scope and safety boundary

The Desktop source tree is not present in this repository, so this remains the
handoff contract. Its separate `feat/cordis-v4-desktop` worktree has now been
checked against production's direct JSON/ETag/304/JSON-404 and direct preset
download probes. That only proves the zero-item production structure today;
it does **not** claim a real public-plugin installation E2E. The old
`spikes/S6` desktop-shaped adapter is useful only as a port-boundary
experiment: its automatic activation behavior must not be copied.

Desktop must consume the v4 JSON contract in
[`cordis-run-api-contract.md`](./cordis-run-api-contract.md). It must preserve
the shared safety lifecycle:

```text
inspect integrity → pre-disable → install without build scripts → verify
→ pending activation → explicit user activate
```

`blocked` is a kill switch. A blocked/deprecated/non-npm/incompatible item may
be displayed, but it must not be installed, updated, or re-enabled.

## DTO replacement

Replace flat `npm`, `version`, `description: String`, and
`total/page/per_page` install inputs with these wire shapes (Rust/Serde sketch):

```rust
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalizedText {
    zh: String,
    en: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NpmSource {
    #[serde(rename = "type")]
    source_type: String, // must equal "npm" before any install path is enabled
    package_name: String,
    version: String,
    integrity: String,
    registry: String,
    tarball: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogPage {
    cursor: Option<String>,
    has_more: bool,
    limit: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginEntry {
    slug: String,
    name: String,
    entry_revision: String,
    description: LocalizedText,
    source: NpmSource,
    platforms: Vec<String>,
    engines: std::collections::BTreeMap<String, String>,
    blocked: bool,
    deprecated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchResponse {
    schema_version: u32,
    catalog_revision: String,
    count: u32,
    page: CatalogPage,
    items: Vec<PluginEntry>,
}

#[derive(Debug, Deserialize)]
struct ApiErrorBody { error: ApiError }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiError { code: String, message: String, request_id: Option<String> }
```

During a short compatibility window, Desktop may deserialize legacy flat fields
into a separate deprecated DTO only for display migration. It must never use
them as an install source when `source` is absent or invalid.

## Request and pagination behavior

- Send `platform=desktop` for the Desktop marketplace; use no `platform` only
  for an all-platform administrative view.
- Prefer `cursor` + `limit` (limit 1–100). Preserve the response cursor exactly;
  it is opaque and may be `null` at the end.
- Existing Desktop request code may temporarily send `page` + `per_page`; the
  fixture maps it to the same result shape. Do not expect `total`, a numeric
  response `page`, or response `per_page`.
- Use `count` as the filtered total and `page.hasMore` to enable the next-page
  control. Do not derive count from the returned slice.

## Install decision checklist

Before showing an enabled install/update action, require all of the following:

1. `source.type == "npm"`, exact `packageName`/`version`, `sha512-...`
   integrity, HTTPS registry and tarball on the same approved registry host.
2. `platforms` includes `desktop`; `blocked` and `deprecated` are false.
3. The DSH engine range is supported by the running Desktop DSH.
4. Detail is freshly refetched; the user confirms its current `entryRevision`.

Pass the nested `source` values through unchanged to artifact inspection and
post-install lockfile verification. Keep the result pending until the user
chooses **Activate**. A 404 must be parsed as `{ error: { code, message } }`
and the message shown as a recoverable catalog error, not as an HTML parse error.

## Acceptance commands

From this repository, the Desktop owner can run the shared fixture and exercise
its client adapter against it:

```bash
node spikes/S1/fixture-server.mjs
# CORDIS_RUN_API=http://127.0.0.1:<printed-port>/api/v1 <desktop test command>
```

Required adapter cases:

- nested `source` and bilingual `description` deserialize unchanged;
- `platform=desktop` returns both fixture entries, then opaque cursor advances;
- legacy `page/per_page` returns the same `count + page` object;
- `category=agent` filters to `desktop-only`;
- ETag revalidation returns 304 after a cached list;
- detail 404 is parsed as `NOT_FOUND` JSON;
- blocked item is visible but never yields an install mutation.

The shared `catalog-core` fixture integration test covers the wire-level cursor,
compatibility, ETag, detail, and error behavior. The Desktop repository has its
own deserialize/install-decision tests and a `pnpm verify:cordis-market` production
structure probe. A real production installation test remains pending an approved
public npm artifact and explicit user activation.
