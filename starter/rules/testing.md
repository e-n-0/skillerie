# Testing

## Choose evidence

- Match verification to the observable behavior and risk. Do not impose blanket
  test counts or coverage quotas.
- For a bug, reproduce the symptom with a discriminating check, fix its cause,
  and show the check passes afterward.
- Keep a regression test when it guards a plausible recurrence.
- Test meaningful behavior, boundaries, invariants, transitions, precedence,
  and real errors rather than wiring or mock echoes.
- When behavior changes intentionally, update affected tests. Investigate
  failures instead of weakening useful assertions.

## Isolation and determinism

- Mock external dependencies in unit tests. Use real provisioned dependencies
  only in authorized integration environments.
- Isolate fixtures, restore modified state, and release resources in teardown.
- Control time and randomness when they affect test outcomes.
- Synchronize on observable events or bounded conditions, not arbitrary
  sleeps.
- Follow the repository's test conventions rather than adding a competing one.

## Verification

- Run focused, finite checks from the correct package or workspace.
- Exercise the changed runtime path. For UI behavior, inspect the rendered
  surface and relevant interactions.
- Run the applicable broader checks after integration.
- If infrastructure prevents a check, use the strongest feasible evidence and
  say exactly what remains unverified.
- Report commands and results accurately; a smoke check does not prove the
  entire system.
