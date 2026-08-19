# Self-review: MIT public-release candidate

Date: 2026-08-20

## Scope reviewed

- Owner-authorized MIT declaration and `apps/web/LICENSE`.
- Public-candidate legal gate and its GitHub Actions artifact-output handoff.
- Release documentation and test-count corrections.

## Safety and correctness review

- The source workspace remains `private: true`; only the generated standalone
  candidate becomes `private: false` and explicitly receives `LICENSE`.
- The public gate still rejects missing, `UNLICENSED`, empty, oversize, and
  non-regular license inputs. It creates no registry, GitHub, database, tag,
  deployment, or catalog mutation.
- `GITHUB_OUTPUT` is written only after the public archive and npm offline pack
  checks succeed. Output names and values are constrained to prevent newline
  injection. The test verifies both emitted values and validates the returned
  temporary artifact path before cleanup.
- The exact candidate passed an authenticated `npm publish --dry-run` with
  public access and `latest`; this is not an npm publication and does not prove
  a configured OIDC publisher.
- No install route, mutation guard, inspect-integrity gate, pre-disable step,
  pending activation behavior, or journal code changed.

## Validation

- `pnpm -r test` — 164/164 pass; journal-core POSIX FULL 96/96.
- `pnpm run pack:check` — pass.
- `pnpm run release:public-check` — `ready` for `@cordis-mp/web@0.1.0`.
- Authenticated `npm publish <candidate> --dry-run --ignore-scripts --access public --tag latest` — pass.
- `node scripts/host-smoke.mjs`, `node scripts/dsh-smoke.mjs`, and
  `node scripts/dsh-e2e-install.mjs` — pass.

## Deliberately unresolved external gates

- The independent repository has no Git remote, so no exact `repository.url`,
  GitHub environment, or npm trusted-publisher identity can be configured.
- npm requires a package to exist before `npm trust` can configure OIDC. The
  first `0.1.0` release therefore needs a separately approved interactive/2FA
  or staged bootstrap; Trusted Publishing can govern later releases.
- No npm publish, tag, push, registry synchronization, production catalog
  write, or production install E2E was run.
