---
paths:
  - "**/*.py"
  - "**/*.pyi"
  - "**/pyproject.toml"
---

# Python

## Toolchain

- Follow the Python version, environment, dependency manager, lockfiles, and
  scripts declared by the repository.
- Keep the configured formatter, linter, type checker, and test runner.
- Do not migrate tools or add dependencies only to match a general preference.
- Run commands in the declared environment and correct package or workspace.

## Style

- Follow repository conventions and add useful annotations at changed
  boundaries.
- Use `dataclasses`, named tuples, and immutable values where they fit.
- Mutate locally owned data efficiently; avoid needless copies.
- Reuse configured rules rather than adding suppressions or new configuration
  without a concrete reason.

## Verification

- Prefer repository scripts for focused, finite tests and static checks.
- Distinguish check-only commands from commands that alter files or the
  environment.
- Run formatters, fixers, or dependency synchronization only when that
  modification is part of the task.
