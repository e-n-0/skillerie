# Code quality

## Style

- Review functions around 50 lines, files around 800 lines, or nesting deeper
  than three levels. Split only when cohesion and readability improve.
- Name domain constants and repeated meaningful values. Ordinary literals do not
  need ceremonial constants.
- Follow the repository's structure and feature boundaries.
- Preserve shared-state and public immutability contracts. Mutate locally owned
  data efficiently and avoid needless copies.

## Error handling and observability

- Catch errors when recovery, translation, cleanup, or useful context is needed.
- Preserve the original cause when adding context.
- Report failures once at the responsible boundary. Do not silently discard
  meaningful errors or return codes.
- Give users actionable messages without exposing secrets or unnecessary
  personal data.

## Design

- Implement the requested behavior without speculative features.
- Avoid premature abstractions; repeated code can be clearer than a helper used
  only once.
- Prefer a clean internal transition and remove obsolete callers when the
  contract allows it.
- Preserve external APIs, persisted data, and durable workflow replay behavior.
  Use explicit migrations when those contracts require them.
- Reuse existing utilities and dependencies. Add a dependency or abstraction
  only when it solves a concrete need.
