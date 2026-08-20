# cordis-mp release preparation

## Current release candidate

- Version: `0.1.1` (root, six core workspaces, and `@webcasa/web` are aligned).
- Status: an unpublished, locally validated patch candidate contains the marketplace-host self-install
  and host-entry conflict protection. `@webcasa/web@0.1.0` was already published
  public with dist-tag `latest` by the approved direct interactive/2FA bootstrap;
  it is immutable and has no OIDC provenance. The `0.1.1` candidate has passed its
  latest post-review local gate (201/201 workspace tests, including journal-core 97/97 with
  its original POSIX FULL 96-test gate intact) and is now on `main`; it must be released through the
  protected Trusted Publishing workflow after its human approvers are configured.
- Package policy: every source workspace remains `private: true`. The only
  intended public package is the generated, dependency-free `@webcasa/web`
  candidate at `0.1.1`, using dist-tag `latest`.
- Scope decision: the direct bootstrap reached npm's authenticated write path,
  where npm rejected the unowned `@cordis-mp` organization scope before any
  package write. The owner then selected the existing `@webcasa` user scope;
  this changes no internal workspace package, DSH plugin id, or install policy.
- Legal metadata: the owner selected MIT and authorized `Copyright (c) 2026
  www.Web.Casa`. `apps/web/package.json` declares `MIT` and its checked-in
  `LICENSE` is explicitly bundled into the public candidate. This is a packaging
  record, not independent legal advice.
- Trusted Publishing is selected for `0.1.1` and later releases. The candidate pins
  `repository.url` to `web-casa/DeepSeek-Harness-Marketplace-Cordis`, and the
  manual-only `.github/workflows/publish.yml` has the required OIDC permission
  and exact-repository check. npm requires a package to exist before its trusted
  publisher can be configured. The `0.1.0` bootstrap is complete, but it does not
  have OIDC provenance; configure and verify the publisher before releasing `0.1.1`.

## Artifact boundary

`@webcasa/web` is the DSH plugin deliverable. Its normal workspace manifest deliberately
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

`@webcasa/web@0.1.0` now exists on npm and the reviewed `publish.yml`
has been pushed to the exact GitHub repository:

1. Create the GitHub `npm` environment and require the intended release
   approvers. Keep the repository public if npm provenance is required.
2. With the owning npm account and 2FA, configure the one allowed publisher:

   ```bash
   npm trust github @webcasa/web \
     --repo web-casa/DeepSeek-Harness-Marketplace-Cordis \
     --file publish.yml \
     --env npm \
     --allow-publish
   ```

3. Verify the recorded relationship with `npm trust list @webcasa/web`, then
   manually dispatch `publish.yml` only from a reviewed `main` commit with
   expected release `@webcasa/web@0.1.1`. The
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
pnpm plugins:sync -- --pkg=@webcasa/web --dry-run --no-assets
```

It fetches the npm packument only and exits nonzero unless the requested name, exact latest
`dsh.bundle`, version, SHA-512 integrity, registry tarball, platform declaration, and DSH engine
all satisfy the strict v4 catalog boundary.  It does not run the database/R2 synchronization
path.  A rejection means stop and repair the published metadata; do not hand-write a catalog
source record.

The owner must then choose an already configured Cordis category.  Only the explicit mutable
command accepts that category, and it honors `--no-assets`:

```bash
pnpm plugins:sync -- --pkg=@webcasa/web \
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
   `@webcasa/web` candidate: it has no workspace dependencies, while every
   source workspace stays private. A package rename or additional public package
   is a separate migration and review.
2. Candidate README, license file and declaration, ownership/access, npm
   maintainers, provenance, and registry policy.
3. A release version if it is not `0.1.1`; update all aligned manifests intentionally and rerun
   the full preflight.
4. A public artifact passes the registry-only preflight and is successfully synchronized by the
   deployed cordis.run v4 API with an owner-approved Cordis category. The service
   itself is live and direct preset download is verified. `0.1.0` already passed this boundary;
   `0.1.1` must repeat it with its own exact version, SHA-512 integrity, and tarball. Fixture/local
   E2E is not evidence of a production API lifecycle release.
5. For Microsoft Store distributions, an independent review and allowlist snapshot update in
   the Desktop repository; production catalog visibility alone never grants Store install rights.

After the OIDC publication has succeeded and registry preflight/sync have been revalidated, create
an annotated tag such as `v0.1.1` from the reviewed commit. Do not create a tag for the unreviewed
or unpublished candidate.

## Published bootstrap record

`@webcasa/web@0.1.0` was published public with `latest` by direct interactive/2FA
bootstrap on 2026-08-20, then passed exact registry preflight and production
`dev-assistant` synchronization. It has no OIDC provenance and must not be
retagged or replaced. Its self-install behaviour is remediated by the separate,
unpublished `0.1.1` patch candidate.

## Release-note template

```md
## 0.1.1 — YYYY-MM-DD

### Added
- Contract-ready catalog client, guarded Web harness, DSH runner, inspection gate, and staged activation flow.
- Market details, trusted screenshots, cursor pagination, platform badges, and actionable errors.
- An in-DSH settings landing page that exposes actual catalog state and the controlled install path;
  its browse CTA only focuses the existing directory and creates no mutation channel.

### Safety
- Install lifecycle remains inspect → pre-disable → install → verify → pending → explicit activate.
- Only a fresh detail response with a confirmed `entryRevision` and complete nested v4 `source`
  can authorize install or activation; snapshot/cache/304 and flat legacy source fields remain browse-only.
- `verifyInstalled` confirms the pnpm lockfile integrity in the exact installed artifact's
  `resolution` mapping, not an unrelated nested field.
- Inspection streams and checks the exact registry tarball before mutation, reads the actual safe
  `dsh.bundle.patch` declaration, and uses only inspected entry ids for pre-disable.
- The marketplace host refuses its own npm package before inspect or any profile mutation, and after
  inspection refuses a foreign bundle that would pre-disable its `cordis-mp` entry id.

### Validation
- 201/201 workspace tests (including journal-core 97/97 with its original POSIX FULL 96-test
  gate intact), host smoke, DSH smoke,
  fixture DSH install/pending/explicit-activate/restart E2E, pack/public-candidate gates,
  actionlint, and production dependency audit passed.
- GitHub Actions [CI run 32325664197](https://github.com/web-casa/DeepSeek-Harness-Marketplace-Cordis/actions/runs/32325664197)
  passed its Ubuntu host/DSH jobs and the first native Windows journal/Web smoke. Windows remains
  BEST_EFFORT.
- A production self-refusal request returns `409 SELF_INSTALL_FORBIDDEN`; this is a safety
  acceptance check, not a positive production plugin lifecycle E2E.

### Known boundary
- `@webcasa/web@0.1.0` is public, strictly synchronized, and produces production API `count=1`.
  The original target was the market host itself, so it is not valid evidence for a positive
  production DSH lifecycle E2E. A separate strict public plugin remains required for that E2E.
- Desktop v4 has a passing production structural smoke; an actual Desktop install E2E and the
  `0.1.1` Trusted Publishing release remain pending.
```
