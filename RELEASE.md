# cordis-mp release preparation

## Current release candidate

- Version: `0.1.0` (root, six core workspaces, and `@cordis-mp/web` are aligned).
- Status: a locally verified standalone implementation candidate exists; no npm
  publication, tag, or visibility change has been performed. Its owner-approved
  GitHub remote is configured locally; it is awaiting the direct first-package
  bootstrap, then npm Trusted Publishing configuration.
- Package policy: every source workspace remains `private: true`. The only
  intended public package is the generated, dependency-free `@cordis-mp/web`
  candidate at `0.1.0`, using dist-tag `latest`.
- Legal metadata: the owner selected MIT and authorized `Copyright (c) 2026
  www.Web.Casa`. `apps/web/package.json` declares `MIT` and its checked-in
  `LICENSE` is explicitly bundled into the public candidate. This is a packaging
  record, not independent legal advice.
- Trusted Publishing is selected for future releases. The candidate pins
  `repository.url` to `web-casa/DeepSeek-Harness-Marketplace-Cordis`, and the
  manual-only `.github/workflows/publish.yml` has the required OIDC permission
  and exact-repository check. npm requires a package to exist before its trusted
  publisher can be configured, so `0.1.0` needs the owner-approved direct
  interactive/2FA bootstrap. Do not claim that bootstrap has OIDC provenance.

## Artifact boundary

`@cordis-mp/web` is the DSH plugin deliverable. Its normal workspace manifest deliberately
remains private and contains `workspace:*` dependencies. The self-contained DSH packer turns
it into a separate candidate manifest with no workspace dependencies, `private: false`,
`dist/index.js`/`dist/client.js`, `data/registry-snapshot.json`, and the declared DSH
`platforms`/`engines` metadata:

```bash
node apps/web/scripts/build.mjs
node apps/web/scripts/pack-smoke.mjs
```

The second command prints a temporary `.tgz` path. It preserves `dist/`: flattening the host
entry would make its `../data/registry-snapshot.json` fallback resolve outside the package.
`node scripts/dsh-smoke.mjs` and `node scripts/dsh-e2e-install.mjs` install that exact artifact
into an isolated DSH profile.

## Release preflight

```bash
CI=true pnpm install --frozen-lockfile
pnpm -r test
node apps/web/scripts/build.mjs
pnpm run pack:check
node scripts/host-smoke.mjs
node scripts/dsh-smoke.mjs
node scripts/dsh-e2e-install.mjs
```

`pnpm run pack:check` runs `npm pack --dry-run --ignore-scripts --json` for each workspace and
for the temporary standalone Web candidate. It checks aligned name/version metadata, the exact
release layout, no leaked workspace dependencies, nonempty file lists, and that ignored
implementation directories are absent. The candidate tarball exists only under the system temp
directory; no registry artifact is written or published, and its local pack integrity is never
used as an installation integrity.

## Public-release legal and artifact gate

Before any `npm publish`, run:

```bash
pnpm run release:public-check
```

This is intentionally separate from normal CI. It validates a non-empty,
non-`UNLICENSED` declaration, a regular non-empty `LICENSE` no larger than
128 KiB, the generated candidate archive, and npm's own
`pack --dry-run --ignore-scripts --offline --json` file list. It makes no
registry, GitHub, database, deployment, publish, tag, or visibility mutation.
It verifies presence and candidate inclusion; the owner remains responsible for
the legal choice and validity of its license expression.

## Configure Trusted Publishing after the bootstrap

Only after `@cordis-mp/web@0.1.0` exists on npm and the reviewed `publish.yml`
has been pushed to the exact GitHub repository:

1. Create the GitHub `npm` environment and require the intended release
   approvers. Keep the repository public if npm provenance is required.
2. With the owning npm account and 2FA, configure the one allowed publisher:

   ```bash
   npm trust github @cordis-mp/web \
     --repo web-casa/DeepSeek-Harness-Marketplace-Cordis \
     --file publish.yml \
     --env npm \
     --allow-publish
   ```

3. Verify the recorded relationship with `npm trust list @cordis-mp/web`, then
   manually dispatch `publish.yml` only from a reviewed `main` commit. The
   token-free validation job reruns workspace tests, pack validation, host
   smoke, DSH smoke, staged-install E2E, and public-candidate validation. The
   OIDC-only job then downloads the SHA-512-verified tarball without checkout
   or dependency installation, and publishes it with no npm token.

`npm trust` changes registry configuration and may require interactive 2FA; it
is deliberately not part of a local helper or this document's read-only checks.

## After an owner-approved npm publication

The generated candidate is not evidence of a registry artifact.  Once the owner has published
the approved package, use the parent repository's read-only registry preflight before any
database synchronization:

```bash
pnpm plugins:sync -- --pkg=@cordis-mp/web --dry-run --no-assets
```

It fetches the npm packument only and exits nonzero unless the requested name, exact latest
`dsh.bundle`, version, SHA-512 integrity, registry tarball, platform declaration, and DSH engine
all satisfy the strict v4 catalog boundary.  It does not run the database/R2 synchronization
path.  A rejection means stop and repair the published metadata; do not hand-write a catalog
source record.

The owner must then choose an already configured Cordis category.  Only the explicit mutable
command accepts that category, and it honors `--no-assets`:

```bash
pnpm plugins:sync -- --pkg=@cordis-mp/web \
  --category=<owner-approved-cordis-category> --no-assets
```

Omitting or misspelling the category fails before synchronization.  This command still needs
the production operator's database authority; it neither publishes npm packages nor changes
their visibility.

## Before a public npm release

Do not remove `private: true`, run `npm publish`, or create a release tag until the owner has
approved all of the following:

1. Public package set and dependency publication order. For the current release
   design, the only intended public package is the generated self-contained
   `@cordis-mp/web` candidate: it has no workspace dependencies, while every
   source workspace stays private. A package rename or additional public package
   is a separate migration and review.
2. Candidate README, license file and declaration, ownership/access, npm
   maintainers, provenance, and registry policy.
3. A release version if it is not `0.1.0`; update all aligned manifests intentionally and rerun
   the full preflight.
4. A public artifact passes the registry-only preflight and is successfully synchronized by the
   deployed cordis.run v4 API with an owner-approved Cordis category. The service
   itself is live and direct preset download is verified, but the strict production catalog is
   currently empty until npm provides the exact version, SHA-512 integrity and tarball for an
   approved package. Fixture/local E2E is not evidence of a production API lifecycle release.
5. For Microsoft Store distributions, an independent review and allowlist snapshot update in
   the Desktop repository; production catalog visibility alone never grants Store install rights.

After approval and a clean preflight, create an annotated tag such as `v0.1.0` from the
reviewed commit. Publishing remains a separate owner-authorized action.

## Release-note template

```md
## 0.1.0 — YYYY-MM-DD

### Added
- Contract-ready catalog client, guarded Web harness, DSH runner, inspection gate, and staged activation flow.
- Market details, trusted screenshots, cursor pagination, platform badges, and actionable errors.

### Safety
- Install lifecycle remains inspect → pre-disable → install → verify → pending → explicit activate.
- `verifyInstalled` confirms the pnpm lockfile integrity for the exact installed artifact.

### Validation
- Workspace tests, host smoke, DSH smoke, and DSH install/activate/restart E2E passed.

### Known boundary
- Production cordis.run v4 API and direct preset download are deployed, but no strict public
  plugin artifact has yet entered the catalog. Its npm publication, registry sync, target probe,
  and lifecycle E2E remain externally pending.
- Desktop v4 has a passing production structural smoke; an actual Desktop install E2E still
  requires the reviewed public entry and explicit user activation.
```
