# Changelog

## 0.0.21 - 2026-10-27

### Fixes

- `install --harness` now leaves the other harness homes unchanged instead of publishing their new content too. `install`, `install --check` and `status` count linked files whose generated content changes, so a new MCP server no longer shows as `up to date`. (#20)

## 0.0.20 - 2026-10-26

### Fixes

- Avoid install crashes when existing extension trees contain large bundled binaries by hashing snapshots incrementally and keeping recovery journals smaller. (#19)

## 0.0.19 - 2026-10-25

### Fixes

- OMO's AGENTS.md no longer repeats instructions.md when the opencode harness is installed at its default path, since OMO already loads that file. (#18)

## 0.0.18 - 2026-10-24

### Features

- New `skillerie import` lists the skills, agents, instructions, MCP servers and harness settings already in your harness homes and copies the ones you pick into the config repository, without secrets and without touching the harness homes. Settings become templates; an existing different template is never overwritten. `init --import` runs it after scaffolding. (#17)

## 0.0.17 - 2026-10-23

### Fixes

- `skillerie status` now compares against the installed profile when no --profile is given, keeps reporting when a profile has TOML conflicts, and `install --force` describes taken-over definitions instead of printing a CONFLICT line. (#16)

## 0.0.16 - 2026-10-23

### Features

- `validate`, `sync` and `doctor` group warnings by code and end with a short summary, `doctor` hides passed checks unless --verbose, `update` prints a table of bumped sources, and long-running commands show progress in a terminal. (#15)

## 0.0.15 - 2026-10-23

### Features

- `skillerie status` and `skillerie uninstall` print one summary row per harness home, list external skills with short names, and show progress in a terminal; uninstall adds --verbose to list every entry. (#14)

## 0.0.14 - 2026-10-23

### Features

- `skillerie install` prints one summary row per harness home instead of one line per file, groups warnings by code, shows progress in a terminal, and adds --verbose to list every file. (#13)

## 0.0.13 - 2026-10-23

### Features

- `skillerie outdated` prints a readable table of changed skills with short source names, lists unchanged skills on one line, says once what to run next, and shows progress in a terminal while it checks and fetches sources. (#12)

## 0.0.12 - 2026-10-23

### Features

- New `skillerie update` command bumps pinned external skills whose skills changed upstream, editing only the pinned ref in skillerie.yaml. (#11)

## 0.0.11 - 2026-10-23

### Features

- `skillerie outdated` compares the skills you use between your pinned commit and upstream, lists the files that changed, and only reports an entry as behind when one of its selected skills changed. (#10)

## 0.0.10 - 2026-10-23

### Features

- `skillerie outdated` colors its results in a terminal: green when a skill is up to date, yellow when it is behind. Set NO_COLOR to turn it off. (#9)

## 0.0.9 - 2026-10-23

### Fixes

- skillerie --version now reports the published version instead of 0.0.0, so engine ranges in skillerie.yaml work. (#8)

## 0.0.8 - 2026-10-23

### Features

- Profiles let one repository hold several setups, such as work and personal. Each profile changes which harnesses, skills, agents, rules, assets and MCP servers are selected; the first one is the default and --profile picks another. A new top-level mcp key selects MCP servers. (#7)

## 0.0.7 - 2026-10-23

### Features

- `skillerie doctor` colors severities and dims locations and codes when printing to a terminal. Set NO_COLOR to turn it off. (#6)

## 0.0.6 - 2026-10-22

### Documentation

- Clearer CLI help and plainer doctor and install messages, including how to replace a file you edited. (#5)

## 0.0.5 - 2026-10-22

### Documentation

- New README with a quickstart and a prompt for setting skillerie up through a coding agent, backed by an agent setup guide for importing an existing setup. (#4)

## 0.0.4 - 2026-10-22

### Fixes

- Quieter validate and doctor output: no content lint inside external skills, one unenforced allowed_tools warning per agent, clean repository locations for external files, and prerelease harness versions accepted by doctor. (#3)

## 0.0.3 - 2026-10-22

### Features

- Skills can be loaded from git repositories with skills.external (GitHub tree links, tags, branches or commits), the new skillerie outdated command reports newer upstream versions, and argument-hint and user-invocable are now optional. (#2)

## 0.0.2 - 2026-10-22

### Features

- Harness assets are included automatically (exclude with assets.disabled); harnesses.<harness>.assets and harnesses.omo.replaceAgents are removed, and adapters now honor sources.harnesses for assets and templates. (#1)
