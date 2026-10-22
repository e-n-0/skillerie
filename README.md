# skillerie

skillerie turns one configuration repository into the skills, agents, rules, instructions, and MCP servers of four AI coding harnesses: OpenCode, Codex, OMO, and Pi. You write each skill and agent once in a shared Markdown dialect. skillerie validates the sources, renders a native copy for every enabled harness, and installs it into each harness home with symlinks, managed config blocks, and backups of anything it replaces.

## Status

skillerie is pre-1.0. The configuration format (`version: 1`) and the authoring dialect (`dialect: 1`) are versioned, but minor releases may still change behavior before 1.0. It runs on macOS and Linux with Node 22 or newer. Windows isn't supported.

## Quickstart

```sh
npx skillerie init my-config
cd my-config
npx skillerie validate
npx skillerie install --check
npx skillerie install
```

`init` detects which harness CLIs are on your `PATH` and enables those. Pass `--harness opencode codex` to pick them yourself. It writes a `package.json` that pins skillerie to the current minor version, so `npm install` gives you a local copy and editor completion for `skillerie.yaml`.

`install --check` prints the plan without writing anything. It exits with status 1 while there is still work to do, so a nonzero exit before your first install is expected. `install` then renders a fresh generation and applies the plan.

## Concepts

<!-- prettier-ignore -->
| Concept | Source in your repository | What skillerie produces |
|-|-|-|
| Skill | `skills/<name>/SKILL.md` plus support files | A skill directory per harness. OpenCode also gets a slash command when `user-invocable: true`. Codex also gets `agents/openai.yaml`. |
| Agent | `agents/<name>.md` | OpenCode Markdown agent, Codex TOML agent, OMO entry under `[native].agents`, Pi Markdown agent |
| Instructions | `instructions.md` | The global `AGENTS.md` of each harness |
| Rule | `rules/<name>.md` | OpenCode `rules/` files; appended to `AGENTS.md` for Codex, OMO, and Pi |
| MCP server | `mcp.json` | The MCP configuration of each harness |
| Harness template | `harnesses/<harness>/templates/` | Native settings files merged with generated content |
| Asset | `harnesses/<harness>/assets/<name>` | Linked as-is, only when listed under `harnesses.<harness>.assets` |
| Seed | `harnesses/<harness>/seeds/` | Copied once if missing, then owned by you |
| Harness-scoped entity | `harnesses/<harness>/skills/`, `harnesses/<harness>/agents/` | A skill or agent rendered for that harness only |
| Post-install hook | `hooks.postInstall` in `skillerie.yaml` | Shell commands run after a successful install |

## Commands

<!-- prettier-ignore -->
| Command | What it does |
|-|-|
| `skillerie init [dir]` | Scaffold a configuration repository |
| `skillerie validate` | Check `skillerie.yaml`, frontmatter, references, and lint rules |
| `skillerie sync` | Render every enabled harness into a new generation; `--check` compares against the current one |
| `skillerie install` | Render, activate the generation, and install it; `--check` is a dry run |
| `skillerie status` | Report ownership of each harness home and any drift |
| `skillerie uninstall` | Remove managed links and restore merged files |
| `skillerie doctor` | Check Node, harness CLIs and versions, required binaries, and writable homes |

Every command accepts `--repo <dir>` (default: the current directory) and the global `--json` flag. See [docs/install.md](docs/install.md) for flags and exit codes.

## Configuration

`skillerie.yaml` sits at the root of your repository. A small one looks like this:

```yaml
version: 1
harnesses:
  opencode:
    enabled: true
  codex:
    enabled: true
skills:
  disabled: [legacy-deploy]
  overrides:
    release:
      requires: { bin: gh }
```

[docs/config.md](docs/config.md) covers every key with its type, default, and an example. The JSON Schema ships in the package at `schema/skillerie.schema.json`.

## Safety model

skillerie only writes to a harness home during `install` and `uninstall`, and it keeps enough state to undo its changes.

- Manifest: each harness home gets `.skillerie/manifest.json`, which records the owning repository, every managed path with its fingerprint, and the original content of every file it replaced or merged into. A second repository can't install into the same home without `--takeover`.
- Backups: before any existing file, link, or directory is replaced or removed, it is moved under `paths.backup` (default `~/.Trash/skillerie`). Nothing is deleted without a backup.
- User edits: if you edit a managed file, `install` and `uninstall` leave it alone and report `USER-EDIT`. `install --force` backs it up and replaces it.
- Dry run: `install --check` plans in memory. It doesn't create directories, write files, or take the lock.
- Atomic generations: rendered output lives in a cache directory. Installed links point through a stable `current` symlink that is swapped atomically, and the previous generation is kept.
- Journal and lock: each install takes a lock in the harness home and writes a journal before changing anything, so an interrupted install is finished on the next run.
- Uninstall: `uninstall` removes managed links, restores merged blocks and replaced files from the manifest, and leaves seeds and edited files in place.

[docs/install.md](docs/install.md) describes the install model in detail.

## Documentation

- [Configuration reference](docs/config.md)
- [Authoring skills and agents](docs/authoring.md)
- [Install, status, and uninstall](docs/install.md)
- Harness notes: [OpenCode](docs/harnesses/opencode.md), [Codex](docs/harnesses/codex.md), [OMO](docs/harnesses/omo.md), [Pi](docs/harnesses/pi.md)
- [Writing an adapter](docs/adapters.md)
- [Engine architecture](docs/architecture.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues as described in [SECURITY.md](SECURITY.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
