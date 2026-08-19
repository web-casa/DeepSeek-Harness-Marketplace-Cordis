# Self-review: public package scope migration

Date: 2026-08-20

## Decision and evidence

- The owner replaced the uncreatable organization scope `@cordis-mp` with the
  existing npm user scope `@webcasa` for the single public candidate.
- The direct publish attempt completed npm browser 2FA and was rejected before
  any package write with `PUT @cordis-mp/web -> 404 Scope not found`.
- Before the bootstrap, read-only registry lookup confirmed `@webcasa/web@0.1.0`
  was not occupied;
  `npm access list packages webcasa` confirms the authenticated account has a
  usable user namespace.

## Changes reviewed

- Only the generated public package identity changes to `@webcasa/web`.
  Private `@cordis-mp/*` workspace modules, the `cordis-mp` DSH plugin id,
  host routes, mutation guards, and journal paths remain unchanged.
- `apps/web/cordis.patch.yml` now names `@webcasa/web`, matching the source and
  generated package manifest. A focused release-artifact test locks this match.
- The public release gate, candidate tarball name, manual OIDC workflow,
  release runbook, parent registry-sync examples, and parent strict-artifact
  fixture all use the new public package identity.

## Validation and review result

- At this scope-migration review point, Web release tests passed 15/15, including
  the new source-manifest/patch-name assertion. Full workspace tests passed 164/164, including POSIX FULL journal
  96/96.
- Pack check, public candidate gate, host smoke, DSH smoke, fixture
  install/activate/restart E2E, `actionlint`, `git diff --check`, and the exact
  script-free `npm publish --dry-run --access public --tag latest` all pass.
- The parent strict-artifact fixture test passes 4/4 with `@webcasa/web` and
  its expected registry tarball URL.
- Security/correctness review found no new credentials, unguarded mutations,
  altered package-manager behavior, or change to journal durability semantics.

## Execution update — 2026-08-20

- `@webcasa/web@0.1.0` was published public as `latest` after the scope migration;
  the npm response completed successfully. The direct release has no OIDC provenance.
- Its exact registry artifact passed the parent preflight and was synchronized to
  `dev-assistant`; the production API contract probe observed `count=1`.
- GitHub `npm` environment approvers and `npm trust github` remain unconfigured;
  those are required before the unpublished `0.1.1` safety patch can be released
  through Trusted Publishing.
