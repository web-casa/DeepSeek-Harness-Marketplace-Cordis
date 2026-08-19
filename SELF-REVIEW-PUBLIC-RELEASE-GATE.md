# Self-review: public release gate and documentation correction

Date: 2026-08-19

## Scope

- Correct current production/API/Desktop rollout documentation using direct
  read-only evidence and completed Desktop source.
- Add an opt-in local public-release gate for the standalone `@cordis-mp/web`
  candidate.
- Do not select a license, change npm visibility, publish, tag, push, contact
  a registry, write production data, or change Desktop/Store policy.

## Review findings and resolution

| Priority | Finding | Resolution |
|---|---|---|
| High | Rollout documents still described the superseded production 404 state. | Updated the nested handoff and parent runbook to distinguish deployed structural API evidence from the still-pending public-artifact lifecycle E2E. |
| High | Desktop documentation suggested legacy `page/per_page` requests although the completed client sends `cursor/limit`. | Replaced it with the verified current behavior; legacy parameters remain server/fixture compatibility only. |
| High | A generated candidate could be mistaken for a public-ready package despite absent legal metadata. | Added `release:public-check`, which fails before public-candidate creation without a non-empty non-`UNLICENSED` declaration and a bounded regular `LICENSE` file. |
| Medium | The first gate draft checked only its intermediate tar layout. | It now also extracts that self-generated artifact and requires the same paths in local `npm pack --dry-run --ignore-scripts --offline --json` output. |
| Low | The freeze report's 92-test value looked current. | Labeled it as freeze-time evidence; the overview records the active suite count. |

## Security and safety review

- The new command only invokes local Node, `tar`, and `npm pack --dry-run --offline`
  with package scripts disabled; it has no publish, tag, network, database, or
  deployment command.
- The license path is fixed to `LICENSE`; it is checked with `lstat`, must be a
  non-empty regular file, and is capped at 128 KiB before copying.
- The public candidate still strips dependencies, development dependencies,
  and scripts. It adds `LICENSE` only in the explicit public-release path.
- Normal candidate packaging, mutation guards, profile locks, journal code,
  and the staged installation lifecycle are unchanged.

## Validation

| Check | Result |
|---|---|
| `pnpm -r test` | 163/163 pass (journal-core 96/96) |
| `pnpm run pack:check` | pass |
| `node scripts/host-smoke.mjs` | pass; mutation without token remains 403 |
| `node scripts/dsh-smoke.mjs` | pass |
| `node scripts/dsh-e2e-install.mjs` | pass: inspect → pre-disable → install → verify → pending → explicit activate → restart |
| `pnpm run release:public-check` | expected status 1: current source lacks an owner-selected license declaration; no candidate/publication is created |

## Deferred owner gates

1. Choose the legal license and copyright holder, then add the actual legal
   text and manifest declaration.
2. Confirm npm identity/access/maintainers/provenance and the Cordis category.
3. Publish the reviewed candidate, run registry-only preflight, then perform
   the approved production synchronization and `count > 0` acceptance.
4. Run approved production DSH/Desktop installation E2E and obtain the first
   hosted Windows BEST_EFFORT CI green run after the independent repository has
   an owner-approved remote.
