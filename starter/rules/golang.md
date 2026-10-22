---
paths:
  - "**/*.go"
  - "**/go.mod"
  - "**/go.sum"
---

# Go

## Conventions

- Follow `go.mod` or `go.work`, the declared Go version, module boundaries,
  framework contracts, and repository tooling.
- Use `gofmt` and any import tooling already adopted by the project.
- Avoid naming stutter. Prefer the standard library and existing dependencies
  before adding packages.
- Use an input struct when it represents a meaningful request or improves call
  clarity; do not introduce one just because a function has several parameters.
- Keep consumer-defined interfaces focused. Accept an interface where
  substitution is useful rather than introducing one for every concrete type.

## Errors and observability

- Return errors rather than hiding them.
- Wrap errors with useful context and `%w` when preserving the cause matters.
- Use `errors.Is` and `errors.As` rather than string matching.
- Define sentinel or typed errors when callers need a stable distinction.
- Follow existing structured logging and correlation conventions. Log once at
  the responsible boundary and omit secrets.

## Concurrency

- Pass `context.Context` first for request-scoped work and honor cancellation
  and deadlines.
- Give goroutines clear ownership and termination conditions.
- Close a channel once by the owner that finishes sending.
- Protect shared state with the synchronization appropriate to the access
  pattern.
- Choose cancellation semantics for the operation rather than always canceling
  all work on the first error.

## Verification

- Run focused, finite `go test` selections from the correct module.
- Use the race detector when supported and relevant.
- Follow configured lint and build tooling; do not assume an unconfigured tool
  is installed.
- Validate configuration at the startup boundary that owns it.
