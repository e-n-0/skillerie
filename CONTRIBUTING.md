# Contributing

Thanks for helping. Bug reports, documentation fixes, and new harness adapters are all welcome.

## Setup

You need Node 22 or newer and npm.

```sh
npm ci
npm run build
node dist/cli.js --help
```

Before opening a pull request, run:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run lint` runs ESLint and `prettier --check`. Use `npm run format` to apply formatting.

## Where things live

<!-- prettier-ignore -->
| Path | Contents |
|-|-|
| `src/config/` | Loading, validating, and defaulting `skillerie.yaml` |
| `src/model/` | Source discovery, frontmatter, selection, and `requires` |
| `src/dialect/` | Shared authoring-dialect parsing and rewrites |
| `src/lint/` | Semantic lint rules |
| `src/engine/` | Validation, sync, and lifecycle orchestration |
| `src/install/` | Install planning, manifest, journal, lock, and merges |
| `src/fs/` | Generation storage and atomic activation |
| `src/adapters/` | One directory per harness |
| `src/doctor/`, `src/init/` | The `doctor` and `init` commands |
| `schema/` | JSON Schema for `skillerie.yaml` |
| `test/` | Tests, synthetic fixtures, and golden output |

Read [docs/architecture.md](docs/architecture.md) before changing the engine contract, and [docs/adapters.md](docs/adapters.md) before adding a harness.

## Guidelines

- Adapters describe rendered files and install actions; only the engine writes to disk.
- Declare a permission capability only when the harness enforces it at runtime.
- Return diagnostics for expected validation failures instead of throwing.
- Use real parsers for YAML, JSONC, and TOML.
- Keep tests deterministic: temporary directories, no sleeps, no network.
- Keep fixtures neutral: `example.com` URLs, generic names such as `alice`, `docs`, or `tracker`, and no real paths, accounts, or credentials.
- When behavior changes, update the matching page under `docs/`.
- Update golden files deliberately and review the diff; `UPDATE_GOLDEN=1` regenerates them for the golden tests.

## Pull requests

Keep each pull request focused on one change and describe what changed and how you tested it. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(codex): render exec policy assets` or `fix(install): keep seeds on uninstall`.

## Release notes and releases

Every pull request that changes user-visible behavior adds `.changes/<pr-number>.yaml`; see [`.changes/README.md`](.changes/README.md) for the format. CI fails a pull request without its note unless it carries the `no-release-note` label.

Each push to `main` that adds at least one note publishes the next patch version to npm and creates a matching GitHub release. The version comes from the latest `vX.Y.Z` tag, so `package.json` in the repository stays at `0.0.0`. The notes added since that tag become the GitHub release text and a new section at the top of `CHANGELOG.md`, which CI commits to `main` as `chore(release): vX.Y.Z` and tags; the package ships the same `CHANGELOG.md`. Never edit released sections by hand in a pull request that also adds notes. Publishing uses npm trusted publishing from the `CI` workflow, so no npm token is stored in the repository.
