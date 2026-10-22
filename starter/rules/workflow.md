# Workflow

## Scope and planning

- Inspect the task, repository guidance, and relevant code before deciding how
  to change something.
- Plan in proportion to risk: a small change needs a brief approach; a broad or
  risky change needs affected areas, dependencies, and acceptance criteria.
- Ask only about material decisions that the available context cannot resolve.
- Keep changes focused. Do not add unrelated cleanup or features.

## Implementation and verification

- Follow repository language, tooling, architecture, and test conventions.
- Prefer small, reviewable changes that can be verified independently.
- Preserve existing behavior outside the requested scope.
- Run the checks relevant to the changed behavior and report their actual
  results.
- Do not skip checks, suppress warnings, or weaken tests to obtain a pass.

## Collaboration and review

- Delegate only work with clear boundaries and acceptance criteria.
- Avoid overlapping ownership when work is parallelized.
- Review actual changes and evidence rather than relying on a completion claim.
- Distinguish verified facts, inferences, and unresolved questions.

## Git and external actions

- Follow repository policy for commits, branches, pull requests, and releases.
- Do not publish, merge, or perform destructive history operations unless the
  task explicitly authorizes that action.
- Preserve unrelated work in the shared checkout.
