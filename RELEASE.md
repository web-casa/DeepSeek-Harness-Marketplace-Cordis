# cordis-mp release preparation

## Current published release

- Version: `0.1.1` (root, six core workspaces, and
  `@webcasa/deepseek-harness-marketplace` are aligned).
- Status: `@webcasa/deepseek-harness-marketplace@0.1.1` was published public with dist-tag
  `latest` through the owner-approved direct interactive/2FA bootstrap. The exact public tarball
  has been independently read back from npm: it has the expected package name/version, MIT license,
  repository, DSH metadata, patch, ten-file layout, and registry SHA-512 integrity. It has no OIDC
  provenance. The guarded one-host cutover has completed: production retains the
  existing `webcasa-web` slug and tool id, has zero `@webcasa/web` rows and one
  `@webcasa/deepseek-harness-marketplace@0.1.1` strict artifact row. The live
  catalog count is therefore `1`, not two market-host entries.
- Package policy: every source workspace remains `private: true`. The only
  intended public package is the generated, dependency-free
  `@webcasa/deepseek-harness-marketplace`
  release at `0.1.1`, using dist-tag `latest`.
- Scope decision: the direct bootstrap reached npm's authenticated write path,
  where npm rejected the unowned `@cordis-mp` organization scope before any
  package write. The owner then selected the existing `@webcasa` user scope;
  this changes no internal workspace package, DSH plugin id, or install policy.
- Legal metadata: the owner selected MIT and authorized `Copyright (c) 2026
  www.Web.Casa`. `apps/web/package.json` declares `MIT` and its checked-in
  `LICENSE` is explicitly bundled into the public candidate. This is a packaging
  record, not independent legal advice.
- Trusted Publishing is selected for the next version after this direct bootstrap. The package pins
  `repository.url` to `web-casa/DeepSeek-Harness-Marketplace-Cordis`, and the
  manual-only `.github/workflows/publish.yml` has the required OIDC permission
  and exact-repository check. The workflow now requires an explicit future release value and checks
  the npm packument before staging, so it refuses an immutable existing version such as `0.1.1`.
  The GitHub `npm` environment is main-only with a manual owner approval rule; configure and verify
  the new package's trusted publisher before dispatching that OIDC workflow.

## Artifact boundary

`@webcasa/deepseek-harness-marketplace` is the published DSH plugin deliverable. Its normal workspace manifest deliberately
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

Before any later `npm publish`, run:

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

## Configure Trusted Publishing after the direct bootstrap

`@webcasa/web@0.1.0` is an immutable historical package. The new
`@webcasa/deepseek-harness-marketplace@0.1.1` identity now exists publicly on npm, but its first
publication was intentionally direct and has no OIDC provenance. Before a later release, use the
reviewed `publish.yml` only after its publisher relationship has been created and verified:

1. The GitHub `npm` environment is configured with an exact `main` deployment branch policy and
   `yeagoo` as the required reviewer. It permits self-review because no independent reviewer was
   specified, and GitHub reports that administrators may bypass it; this is a manual owner checkpoint,
   not independent separation of duties. Keep the repository public if npm provenance is required.
2. With the owning npm account and 2FA, configure the one allowed publisher:

   ```bash
   npm trust github @webcasa/deepseek-harness-marketplace \
     --repo web-casa/DeepSeek-Harness-Marketplace-Cordis \
     --file publish.yml \
     --env npm \
     --allow-publish
   ```

3. Verify the recorded relationship with `npm trust list @webcasa/deepseek-harness-marketplace`, then
   manually dispatch `publish.yml` only from a reviewed `main` commit with
   expected release `@webcasa/deepseek-harness-marketplace@<next-version>`; there is deliberately
   no prefilled version. The
   token-free validation job reruns workspace tests, pack validation, host
   smoke, DSH smoke, staged-install E2E, and public-candidate validation. The
   OIDC-only job then downloads the SHA-512-verified tarball without checkout
   or dependency installation, and publishes it with no npm token.

`npm trust` changes registry configuration and requires interactive 2FA for the currently authenticated
owner. Both creation and `npm trust list` currently stop at that authentication requirement, so no
trusted-publisher relationship has been claimed as configured or verified. It is deliberately not part
of a local helper or this document's read-only checks.

## Registry proof and guarded catalog cutover

The generated candidate is not evidence of a registry artifact. The direct `0.1.1` publication has
now passed the parent repository's read-only registry preflight before any database synchronization:

```bash
pnpm plugins:sync -- --pkg=@webcasa/deepseek-harness-marketplace --dry-run --no-assets
```

It fetches the npm packument only and exits nonzero unless the requested name, exact latest
`dsh.bundle`, version, SHA-512 integrity, registry tarball, platform declaration, and DSH engine
all satisfy the strict v4 catalog boundary.  It does not run the database/R2 synchronization
path.  A rejection means stop and repair the published metadata; do not hand-write a catalog
source record.

The owner selected the existing `dev-assistant` Cordis category. The guarded
one-host replacement has been executed with a verified backup and exact
registry artifact attestation; it preserved `webcasa-web` and left exactly one
installable market-host. Do not rerun the historical cutover command. Any
future source replacement remains a separate production operation with a new
owner confirmation and backup.

## Before a later public npm release

Do not remove `private: true`, run `npm publish`, or create a release tag until the owner has
approved all of the following:

1. Public package set and dependency publication order. For the current release
   design, the only intended public package is the generated self-contained
   `@webcasa/deepseek-harness-marketplace` candidate: it has no workspace dependencies,
   while every source workspace stays private. The old `@webcasa/web@0.1.0` registry
   artifact remains historical and must not be overwritten or represented as this candidate.
2. Candidate README, license file and declaration, ownership/access, npm
   maintainers, provenance, and registry policy.
3. For a later release, choose a new version; update all aligned manifests intentionally and rerun
   the full preflight.
4. A public artifact passes the registry-only preflight and is successfully synchronized by the
   deployed cordis.run v4 API with an owner-approved Cordis category. The service itself is live and
   direct preset download is verified. Both direct bootstrap versions have their own exact registry
   evidence; each later version must repeat the same proof. Fixture/local E2E is not evidence of a
   production API lifecycle release.
5. For Microsoft Store distributions, an independent review and allowlist snapshot update in
   the Desktop repository; production catalog visibility alone never grants Store install rights.

After a future OIDC publication has succeeded and registry preflight/sync have been revalidated,
create an annotated tag only with separate owner approval, using that reviewed version. Do not
create a tag merely because a local candidate or direct bootstrap exists.

## Published bootstrap record

`@webcasa/web@0.1.0` was published public with `latest` by direct interactive/2FA
bootstrap on 2026-08-20, then passed exact registry preflight and production
`dev-assistant` synchronization. It has no OIDC provenance and must not be retagged or rewritten.
`@webcasa/deepseek-harness-marketplace@0.1.1` was then published public with `latest` by the same
owner-approved direct interactive/2FA method; its exact registry artifact and strict preflight are
verified, and it is the sole synchronized production market-host after the
guarded cutover.

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
- 206/206 workspace tests (including journal-core 97/97 with its original POSIX FULL 96-test
  gate intact), host smoke, DSH smoke,
  fixture DSH install/pending/explicit-activate/restart E2E, pack/public-candidate gates,
  actionlint, and production dependency audit passed.
- GitHub Actions [CI run 32325664197](https://github.com/web-casa/DeepSeek-Harness-Marketplace-Cordis/actions/runs/32325664197)
  passed its Ubuntu host/DSH jobs and the first native Windows journal/Web smoke. Windows remains
  BEST_EFFORT.
- CI and the publish workflow pin `actions/checkout` and `actions/setup-node` to their Node
  24-compatible v5 commits, so the earlier Node 20 action-runtime deprecation annotation does not
  apply to future runs. [CI run 32326135751](https://github.com/web-casa/DeepSeek-Harness-Marketplace-Cordis/actions/runs/32326135751)
  revalidated all three CI jobs with those pins.
- A production self-refusal request returns `409 SELF_INSTALL_FORBIDDEN`; this is a safety
  acceptance check, not a positive production plugin lifecycle E2E.

### Known boundary
- `@webcasa/web@0.1.0` is historical only. Production `count=1` is the sole
  synchronized `@webcasa/deepseek-harness-marketplace@0.1.1` entry under the
  retained `webcasa-web` slug; any future cutover must still avoid two
  installable market-host entries.
  The original target was the market host itself, so it is not valid evidence for a positive
  production DSH lifecycle E2E. A separate strict public plugin remains required for that E2E.
- Desktop v4 has a passing production structural smoke; an actual Desktop install E2E remains
  pending. Trusted Publishing configuration and a later OIDC release are separate pending work.
```
