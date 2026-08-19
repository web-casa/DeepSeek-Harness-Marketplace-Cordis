# @cordis-mp/web

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

No npm publication is performed by these commands. A public registry release
still requires the package owner to approve the npm scope/access, license,
maintainers, provenance policy, and release version. Once published, run the
parent repository's registry sync so cordis.run can capture the registry's
exact tarball URL and SHA-512 integrity; hand-written catalog source data is
not accepted.

The current source has no selected legal license declaration or bundled license file. That
legal decision must be made and added to the generated artifact before any
public publication; it must not be copied from the parent repository by
assumption.

After that owner decision, run `pnpm run release:public-check` from the
repository root before publishing. It locally verifies the declaration, a
bounded regular `LICENSE` file, the generated candidate, and npm's script-free
offline dry-run file list; it does not publish or contact a registry.
