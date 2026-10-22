<p align="center">
  <img src="docs/assets/logo.svg" width="120" height="120" alt="skillerie logo">
</p>

<h1 align="center">skillerie</h1>

<p align="center">
  <b>Write your agent skills once. Install them in every coding agent.</b>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/skillerie"><img alt="npm" src="https://img.shields.io/npm/v/skillerie?style=flat-square"></a>
  <a href="https://github.com/e-n-0/skillerie/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/e-n-0/skillerie/ci.yml?branch=main&style=flat-square"></a>
  <a href="https://github.com/e-n-0/skillerie/blob/main/package.json"><img alt="Node" src="https://img.shields.io/node/v/skillerie?style=flat-square"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/e-n-0/skillerie?style=flat-square"></a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#set-up-with-your-coding-agent">Set up with your agent</a> ·
  <a href="docs/config.md">Docs</a>
</p>

skillerie turns one git repository of skills, agents, rules, instructions and MCP servers into native configuration for [OpenCode](https://opencode.ai), [Codex](https://github.com/openai/codex), [OMO](https://github.com/code-yeongyu/oh-my-openagent) and [Pi](https://pi.dev), and keeps them all in sync.

```mermaid
flowchart LR
  repo["Your config repo<br/>skills · agents · rules · MCP"] --> skillerie((skillerie))
  skillerie --> OpenCode
  skillerie --> Codex
  skillerie --> OMO
  skillerie --> Pi
```

## Why skillerie

- **One source of truth.** Write a skill once in plain Markdown. skillerie translates tool names, question tools, sub-agents and skill references into what each harness understands.
- **Reuse community skills.** Load skills straight from GitHub, pinned to a tag or commit, and run `skillerie outdated` to see when upstream moves.
- **Safe by default.** Dry-run every install, back up anything replaced, keep your manual edits, and undo it all with `skillerie uninstall`.
- **Checked before it ships.** `validate` catches broken references and invalid frontmatter, and `doctor` has Codex and OpenCode check the config skillerie renders for them.

## Quickstart

Requires Node 22 or newer on macOS or Linux.

```sh
npx skillerie init my-agents     # enables the harnesses found on your PATH
cd my-agents
npx skillerie install --check    # show the plan, write nothing
npx skillerie install
```

Add skills under `skills/<name>/SKILL.md`, or pull them from GitHub:

```yaml
# skillerie.yaml
skills:
  external:
    - url: https://github.com/openai/skills/tree/main/skills/.curated/gh-fix-ci
```

Run `npx skillerie install` again after every change.

## Set up with your coding agent

Paste this into Claude Code, Codex, OpenCode or any other coding agent:

```text
Set up skillerie for me by following
https://raw.githubusercontent.com/e-n-0/skillerie/main/docs/agent-setup.md
Bring in the skills and agents I already have, show me the install plan,
and ask me before installing anything.
```

## Supported harnesses

Each harness gets skills, agents, rules, instructions and MCP servers in its own native format, merged with your harness settings.

<!-- prettier-ignore -->
| Harness | Installs into |
|-|-|
| [OpenCode](docs/harnesses/opencode.md) | `~/.config/opencode` |
| [Codex](docs/harnesses/codex.md) | `~/.codex` |
| [OMO](docs/harnesses/omo.md) | `~/.omo` |
| [Pi](docs/harnesses/pi.md) | `~/.pi/agent` |

## Documentation

- [Configuration](docs/config.md): every `skillerie.yaml` key, external skills, MCP servers
- [Authoring](docs/authoring.md): the shared Markdown dialect and how each harness translates it
- [Install and safety model](docs/install.md): commands, backups, ownership, uninstall
- [Agent setup guide](docs/agent-setup.md): how a coding agent sets skillerie up for you

skillerie is pre-1.0: the config format is versioned, but minor releases may still change behavior.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md), and report security issues as described in [SECURITY.md](SECURITY.md).

Licensed under [Apache-2.0](LICENSE).
