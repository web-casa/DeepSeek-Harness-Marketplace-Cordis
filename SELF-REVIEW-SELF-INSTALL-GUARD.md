# Self-review: marketplace-host installation guard

Date: 2026-08-20

> Publication update: `@webcasa/web@0.1.0` below is the immutable production target used for the
> historical self-refusal probe. `@webcasa/deepseek-harness-marketplace@0.1.1` is now public but
> unsynchronized; it loads its identity from its own manifest, while the `cordis-mp` entry-id conflict
> guard remains the protection against the old host package or any foreign bundle.

## Trigger and scope

The production catalog now contains `@webcasa/web@0.1.0`, which is itself the
Cordis market host. A real target run correctly exercised inspect → pre-disable
→ install → verify → pending, but then could not reach the host's activate route:
pre-disable had disabled the host's `cordis-mp` entry. This review covers the
`0.1.1` local patch candidate only; it does not rewrite the immutable `0.1.0`
registry artifact or claim a positive production lifecycle E2E.

## Findings fixed

1. `InstallService` now receives the host package name from its own packaged
   `package.json` and rejects an exact catalog source-package match with
   `SELF_INSTALL_FORBIDDEN` before inspection, journal, pre-disable, package
   manager, pending state, or profile write.
2. Exact package-name protection alone was insufficient: a foreign package could
   advertise the host's DSH entry id. The host loads the entry ids from its own
   bundled `cordis.patch.yml`; after integrity inspection determines actual entry
   ids, an intersection fails with `HOST_ENTRY_CONFLICT` before the profile lock,
   journal, pre-disable, install, verify, or pending state.
3. The inspection/finally boundary was widened so a staged artifact is cleaned
   even when the post-inspection host-entry check rejects it.
4. Both diagnostic codes map through the existing guarded mutation handler to
   a recoverable HTTP 409. No route bypasses the existing session/Origin/Host
   checks or mutation guard.

## Validation

- install-core tests cover exact self-package refusal with no inspect/journal/
  activation/package mutation, and a foreign host-entry collision with staged
  artifact cleanup and no mutation.
- web-harness tests cover the two 409 diagnostic mappings; host runtime tests
  assert packaged `@webcasa/web` and `cordis-mp` self identity are wired.
- The production-catalog self-refusal command completed against
  `https://cordis.run/api/v1` with `SELF_INSTALL_FORBIDDEN` and verified that it
  did not pre-disable `cordis-mp` in the temporary profile.
- The historical pre-full-review local validation passed 166/166 workspace tests, including
  journal-core POSIX FULL 96/96, pack/public-release gates, host/DSH smoke,
  fixture install → pending → explicit activate → restart E2E, actionlint, and
  whitespace checks. The exact candidate also passed script-free
  `npm publish --dry-run --access public --tag latest`; it was not published. The superseding
  whole-project review is recorded in `SELF-REVIEW-CODEX-FULL-REVIEW.md`.

## Residual boundary

The current independent strict production catalog has only the historical market-host entry. A
separate reviewed public plugin is required for a valid positive DSH install → pending → explicit
activate → restart E2E. The public `0.1.1` artifact has passed exact preflight; its guarded catalog
cutover and later Trusted Publishing configuration remain pending.
