---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/tsconfig.json"
---

# TypeScript

## Types and conventions

- Follow the repository's strictness, module format, framework contracts, and
  type conventions.
- Prefer precise types and `unknown` with narrowing for untrusted values.
- Avoid unexamined `any`, assertions, and suppressions.
- Validate external input at runtime with the repository's established schema
  or validation approach.
- Preserve public immutability and framework state contracts. Mutate locally
  owned objects efficiently rather than copying on every update.

## Errors and asynchronous behavior

- Follow repository async and error conventions.
- Catch errors only for recovery, translation, cleanup, or useful context.
- Preserve causes when adding context and avoid redundant wrappers.
- Log once at the responsible boundary without exposing sensitive data.

## Verification

- Inspect workspace configuration, scripts, and lockfiles before choosing a
  command.
- Use the repository's type-check, lint, test, and build scripts.
- Select finite CI modes rather than watch commands.
- Use check-only formatting unless formatting changes are part of the task.
- Do not download ad hoc tooling or replace repository configuration.
