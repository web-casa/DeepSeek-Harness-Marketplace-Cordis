# Self-review: OIDC publish workflow and bootstrap boundary

Date: 2026-08-20

## Scope reviewed

- Exact GitHub repository metadata and public/latest `@webcasa/web` candidate metadata.
- `.github/workflows/publish.yml` and its npm Trusted Publishing boundary.
- Operator documentation for direct bootstrap followed by OIDC.

## Findings fixed before commit

1. The supplied remote is public, non-archived, empty, and defaults to `main`.
   The local branch is aligned to `main`; the candidate's canonical GitHub URL
   matches that repository.
2. The initial workflow could have run from a manually selected branch. It now
   runs only for `refs/heads/main` and still requires the explicit boolean
   confirmation plus the GitHub `npm` environment.
3. The initial workflow gave `id-token: write` to a job that installed
   dependencies. It is now split: `validate` has only `contents: read`, runs
   every release check, and uploads one fixed-name candidate tarball; `publish`
   receives the only OIDC permission, does not checkout or install dependencies,
   downloads the artifact through pinned GitHub actions, verifies a recorded
   SHA-512, then runs `npm publish --ignore-scripts`.
4. The pinned setup-node v4 action does not support `package-manager-cache`; it
   was removed. No cache input is set for the elevated publish job.

## Security result

- No npm token, npm secret, or write-capable GitHub token is configured.
- OIDC is constrained to the future `publish` job, GitHub-hosted Ubuntu,
  protected `main`, the `npm` environment, exact repository identity, and the
  post-bootstrap npm trusted-publisher configuration.
- Inputs are checked as exact release identity values; candidate output names
  and paths are constrained by the existing public-release gate and tests.
- Existing mutation guards, inspect integrity, pre-disable, pending activation,
  explicit activation, and POSIX FULL journal code are untouched.

## Validation

- At the original workflow-review point, `pnpm -r test` — 164/164 pass;
  journal-core POSIX FULL 96/96. The subsequent `0.1.1` guard candidate is
  covered by its own 166/166 final-validation record.
- `pnpm run pack:check`, `pnpm run release:public-check`, host smoke, DSH
  smoke, and DSH install/activate/restart E2E — pass.
- `actionlint .github/workflows/ci.yml .github/workflows/publish.yml` and
  `git diff --check` — pass.
- The final generated candidate passed authenticated
  `npm publish --dry-run --ignore-scripts --access public --tag latest`.

## Execution update — 2026-08-20

- The owner-approved direct interactive/2FA bootstrap published
  `@webcasa/web@0.1.0` with `latest` and public access. It is explicitly a
  bootstrap rather than an OIDC-provenance release.
- Parent strict registry preflight, `dev-assistant` synchronization, and the
  production API contract probe succeeded with `count=1`.
- The GitHub `npm` environment still needs owner-selected human approvers, then
  `npm trust github` must be configured and verified. The next intended release
  is `@webcasa/web@0.1.1`, not a replacement of immutable `0.1.0`.
- A positive production DSH/Desktop lifecycle E2E remains pending an independent
  strict public plugin; the market host self-target is intentionally refused.
