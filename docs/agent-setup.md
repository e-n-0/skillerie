# Setting up skillerie: a guide for coding agents

You are helping a user manage their coding-agent configuration with skillerie. Follow these steps in order. Ask the user before every step that changes their harness homes (`~/.config/opencode`, `~/.codex`, `~/.omo`, `~/.pi`).

## 1. Check prerequisites

- `node --version` must be 22 or newer, and `git` must be installed.
- Find the harnesses in use: `command -v opencode codex omo pi`.
- If the user already has a skillerie config repository (a directory with `skillerie.yaml`), skip to step 4.

## 2. Create the config repository

Ask the user where to keep it if they haven't said; suggest `~/agents`. Then run:

```sh
npx skillerie@latest init ~/agents
```

`init` enables the harnesses whose CLIs are on `PATH`. Pass `--harness opencode codex` to choose explicitly. It creates `skillerie.yaml`, `instructions.md`, `mcp.json`, and empty `skills/`, `agents/` and `rules/` directories.

## 3. Bring in what the user already has

Ask which of these to import, then copy, don't move. The originals stay in place until `install` backs them up.

- **Skills**: directories containing a `SKILL.md` under `~/.config/opencode/skills`, `~/.codex/skills` (skip `.system`), `~/.omo/agent/skills`, `~/.pi/agent/skills`, `~/.agents/skills` and `~/.claude/skills`. Copy each into `skills/<name>/` with its support files. Skip symlinks that point into `~/.cache/skillerie`, because skillerie already manages those. When two copies share a name, show the user the differences and keep one.
- **Skills from public repositories**: if a skill is an unmodified copy of a skill on GitHub, prefer a `skills.external` entry in `skillerie.yaml` over a copy, pinned with `ref` to a tag or commit. See [external skills](config.md#skillsexternal).
- **Agents**: Markdown agents with frontmatter from `~/.config/opencode/agents` and `~/.claude/agents` go into `agents/<name>.md`.
- **Instructions**: merge the user's global `AGENTS.md` (or `CLAUDE.md`) content into `instructions.md`. Show the merged result before saving.
- **MCP servers**: translate existing server definitions into the `mcpServers` map of `mcp.json`, described in [mcp.json](config.md#mcpjson). Never copy tokens or keys into the repository; reference them through environment variables or files.

## 4. Validate

```sh
npx skillerie validate
```

Fix every `error` and re-run until it exits 0. Warnings may stay; mention them to the user. The [authoring guide](authoring.md) explains the frontmatter and dialect that `validate` checks.

## 5. Show the plan

```sh
npx skillerie install --check
```

This writes nothing. Summarize the plan for the user: how many paths will be linked, replaced (`BACKUP` lines, moved to `~/.Trash/skillerie`), or merged into existing config files. `CONFLICT` lines mean an existing config file already defines something skillerie manages; installing over them needs `--force`, which backs those definitions up first.

## 6. Install, with the user's approval

Ask the user to confirm, then run `npx skillerie install`. Add `--force` only if they agreed to take over the conflicts from step 5. Then run:

```sh
npx skillerie doctor
```

Report any `error` lines. Tell the user to restart their harnesses so they pick up the new skills and agents.

## 7. Finish

- Suggest `git init` and a first commit in the config repository so it can be shared across machines.
- After any later change, the user runs `npx skillerie install` again; `npx skillerie outdated` reports external skills with newer upstream versions.
- `npx skillerie uninstall` restores everything skillerie replaced.

## Rules

- Never edit files inside harness homes or `~/.cache/skillerie` directly. Change the config repository and reinstall.
- Never run `install`, `install --force` or `uninstall` without the user's explicit confirmation.
- Keep secrets out of the repository.
