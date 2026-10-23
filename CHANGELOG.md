# Changelog

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
