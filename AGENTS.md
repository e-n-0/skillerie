# Contributor guide

## Layout

- `src/core/types.ts`: public contract entry point, with focused supporting type modules.
- `src/config/`: configuration loading, parsing, defaults, and expansion.
- `src/model/`: source discovery, frontmatter, eligibility, and entity merging.
- `src/dialect/`: shared authoring-dialect transformations.
- `src/lint/`: semantic validation.
- `src/fs/`: generation storage and atomic activation.
- `src/adapters/`: harness-specific rendering and installation descriptions.
- `src/cli.ts`: command entry point.
- `test/`: synthetic fixtures and tests.
- `docs/`: architecture and contributor documentation.
- `schema/` and `starter/`: reserved package content for later implementation.

## Commands

Use Node 22 or newer and npm. Install with `npm ci`. Run `npm run typecheck`,
`npm run lint`, `npm test`, and `npm run build` before submitting changes.
Use `npm run format` to apply formatting.

## Conventions

Write strict TypeScript with ESM imports using `.js` extensions. Keep shared
contracts readonly, parse input at module boundaries, and return diagnostics
for expected validation failures. Use real parsers for YAML, JSONC, and TOML.
Keep fixtures synthetic and avoid machine-specific paths or credentials.

Adapters only describe rendered files and install actions. The engine performs
all filesystem mutations, ownership checks, backups, locking, and rollback.
Capability declarations must describe enforced behavior; prompt text does not
enforce permissions. Core imports go through `src/core/types.ts`.

This bootstrap intentionally contains throwing module stubs and commands that
exit with status 2. Replace each stub with its implementation and focused tests.
