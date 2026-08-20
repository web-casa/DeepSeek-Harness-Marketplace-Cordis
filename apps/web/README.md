# @webcasa/deepseek-harness-marketplace

Cordis marketplace plugin for DeepSeek Harness (DSH). The locally verified
standalone candidate bundles the marketplace host and client, while keeping the plugin's
catalog/install lifecycle behind the existing guarded DSH host routes.

## DSH compatibility

- Platforms: `web`, `desktop`
- DSH: `>=0.1.0-rc.7 <0.2.0`
- Package source: npm registry only, with an exact version and SHA-512
  integrity recorded by cordis.run before it can enter the public catalog.

The package declares a DSH bundle patch at `cordis.patch.yml`. Installation is
not activation: the supported lifecycle is

```text
inspect integrity → pre-disable → install without package scripts → verify
→ pending activation → user explicitly activates
```

Every marketplace mutation remains guarded by the host's existing mutation
token and profile lock. A catalog item marked `blocked` or `deprecated` is
display-only and cannot cross the installation gate.

## Settings landing page

The plugin's only visual entry point is DSH `settings.section`. It opens with
an in-product landing page, then continues directly into the existing catalog:

- the status card reflects the real catalog request state and count; it does not
  manufacture availability claims;
- the six visible stages mirror the actual lifecycle above, including default
  pending state and explicit activation;
- “浏览目录” only scrolls to and focuses the existing search control. It does
  not install, activate, or create a second mutation route.

## Release candidate layout

The source workspace intentionally remains private. Build a standalone
candidate with:

```bash
node apps/web/scripts/build.mjs
node apps/web/scripts/pack-smoke.mjs
```

The tarball contains `dist/index.js`, `dist/client.js`, the root-level
`data/registry-snapshot.json`, and the bundle patch. Keeping `dist/` intact is
required for the host's offline snapshot fallback to resolve correctly.

No npm publication is performed by these commands. The generated public package
`@webcasa/deepseek-harness-marketplace@0.1.1` is now public with dist-tag
`latest`, MIT, and `Copyright (c) 2026 www.Web.Casa`; its direct interactive/2FA
bootstrap has no OIDC provenance. The earlier `@webcasa/web@0.1.0` publication
is an immutable historical bootstrap and is not the identity of this package.
The workspace source deliberately remains private; only its generated,
dependency-free candidate is publishable.

Before any later publication, run `pnpm run release:public-check` from the repository
root. It locally verifies the declaration, bounded regular `LICENSE` file,
generated candidate, and npm's script-free offline dry-run file list; it does
not publish or contact a registry.

Trusted Publishing is selected for releases after the first bootstrap of this
new npm package identity.
`repository.url` is pinned to
`web-casa/DeepSeek-Harness-Marketplace-Cordis`, and the checked-in manual-only
`.github/workflows/publish.yml` validates that exact repository before it
publishes with GitHub OIDC. It runs only from `main`; protect that branch and
its `npm` environment before enabling the workflow. Validation, dependency
installation, pinned DSH CLI provision, build, pack and DSH E2E run without an
OIDC token; a separate job downloads the SHA-512-verified tarball and is the
only job allowed to exchange an OIDC token for publication.

npm requires a package to exist before a Trusted Publisher can be configured.
The `0.1.1` direct bootstrap now satisfies that prerequisite; configure and
verify the publisher with the exact remote and workflow filename before any
later OIDC release. The workflow requires an explicit future version and
refuses an already-published npm version before staging. Its registry artifact
has passed the parent repository's read-only preflight, but the production
catalog must use a guarded one-host cutover rather than create a second
installable market-host entry. Hand-written catalog source data is not accepted.
