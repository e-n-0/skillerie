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

From the config repository, run `npx skillerie import --list` and review the inventory with the user. Then run `npx skillerie import <name>...`, or `npx skillerie import --all` for every unambiguous item. In a terminal, `npx skillerie import` offers an interactive picker. A new repository can use `npx skillerie init <dir> --import` to go straight to this step. See [import](install.md#import) for scan locations and selection syntax.

- **Differing copies:** show the user the differences and choose the intended copy with `name@source`, for example `review@codex`. Do not assume the first copy is authoritative.
- **Public skills:** if a skill is an unmodified copy of one on GitHub, use a [`skills.external`](config.md#skillsexternal) entry pinned with `ref` instead of keeping a local copy.
- **Instructions:** review the selected instructions. If import creates `instructions.imported.md`, show the proposed merge into `instructions.md` before saving it.
- **MCP secrets and agent fields:** review the reported missing secret fields and dropped agent settings. Restore credentials through environment or file references, not literal values in the repository.

## Rules

- Never run `install`, `install --force` or `uninstall` without the user's explicit confirmation. Use `--force` only if they agreed to take over the conflicts shown by `--check`.
- Never edit files inside harness homes or `~/.cache/skillerie`; change the config repository and reinstall.
- Never copy tokens or keys into the repository; reference them through environment variables or files.
