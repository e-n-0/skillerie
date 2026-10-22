# Changelog

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
