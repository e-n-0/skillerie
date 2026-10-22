# Setting up skillerie: a guide for coding agents

You are setting up skillerie for a user. Command details are in [install.md](install.md); this guide covers the order of steps, how to bring in the user's existing setup, and what to confirm with them first.

## Steps

1. Check that `node --version` is 22 or newer and find the harnesses in use with `command -v opencode codex omo pi`.
2. If the user has no skillerie config repository yet, ask where to create one (suggest `~/agents`) and run `npx skillerie@latest init <dir>`. See [init](install.md#init).
3. Import their existing setup, as described below.
4. Run `npx skillerie validate` and fix every error. Warnings may stay; mention them.
5. Run `npx skillerie install --check` and summarize the plan for the user: what gets linked, what gets backed up to `~/.Trash/skillerie`, and any `CONFLICT` lines. See [install](install.md#install).
6. Install only after the user confirms. Run `npx skillerie doctor` afterwards and report any errors.
7. Suggest committing the config repository to git, and tell the user to restart their harnesses.

## Importing an existing setup

Ask which of these to import. Copy, don't move: the originals stay in place until `install` backs them up.

- **Skills:** directories with a `SKILL.md` in `~/.config/opencode/skills`, `~/.codex/skills` (skip `.system`), `~/.omo/agent/skills`, `~/.pi/agent/skills`, `~/.agents/skills` and `~/.claude/skills`. Copy each into `skills/<name>/` with its support files. Skip symlinks into `~/.cache/skillerie`, which skillerie already manages. When two copies share a name, show the user the differences and keep one.
- **Public skills:** if a skill is an unmodified copy of one on GitHub, add a [`skills.external`](config.md#skillsexternal) entry pinned with `ref` instead of copying it.
- **Agents:** Markdown agents with frontmatter from `~/.config/opencode/agents` and `~/.claude/agents` go into `agents/<name>.md`.
- **Instructions:** merge the user's global `AGENTS.md` or `CLAUDE.md` into `instructions.md`, and show the result before saving.
- **MCP servers:** translate existing definitions into the `mcpServers` map of [`mcp.json`](config.md#mcpjson).

## Rules

- Never run `install`, `install --force` or `uninstall` without the user's explicit confirmation. Use `--force` only if they agreed to take over the conflicts shown by `--check`.
- Never edit files inside harness homes or `~/.cache/skillerie`; change the config repository and reinstall.
- Never copy tokens or keys into the repository; reference them through environment variables or files.
