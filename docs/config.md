# Configuration reference

A skillerie configuration repository has a `skillerie.yaml` at its root and a few conventional directories:

```text
skillerie.yaml
instructions.md
mcp.json
skills/<name>/SKILL.md      # plus any support files next to it
agents/<name>.md
rules/<name>.md
bin/                        # helper scripts, referenced from mcp.json with ${repo}/bin/...
harnesses/<harness>/
  templates/                # native settings files, merged with generated content
  assets/<name>             # automatically selected files or directories, linked as-is
  seeds/                    # copied only when missing
  skills/<name>/SKILL.md    # skills for this harness only
  agents/<name>.md          # agents for this harness only
```

Every part is optional except `skillerie.yaml`. `<harness>` is one of `opencode`, `codex`, `omo`, or `pi`.

## How skillerie.yaml is parsed

The file is read as YAML 1.2 with the core schema, so `no` and `off` stay strings. Duplicate keys are an error. The document is validated against `schema/skillerie.schema.json`, which ships with the package; unknown keys are rejected and every error points at a line. Point your editor at the schema for completion:

```yaml
# yaml-language-server: $schema=./node_modules/skillerie/schema/skillerie.schema.json
```

`skillerie init` writes that line for you.

## Variables

String values in `skillerie.yaml`, in `mcp.json`, and in `.json`, `.jsonc`, and `.toml` templates support a few placeholders. Mapping keys, Markdown files, and other template formats are left alone.

<!-- prettier-ignore -->
| Placeholder | Expands to |
|-|-|
| `~` at the start of a value | Your home directory |
| `${repo}` | Absolute path of the configuration repository |
| `${home}` | Your home directory |
| `${paths.<name>}` | The resolved value of `paths.<name>` |
| `$${...}` | A literal `${...}` |

Any other `${...}` is an error. Placeholders that harnesses expand themselves, such as OpenCode's `{env:NAME}` or a shell `$NAME`, pass through because they don't match `${...}`. To keep a literal `${NAME}` for a harness, write `$${NAME}`.

Relative paths in `paths` and `harnesses.<harness>.path` are resolved against the repository.

## Top-level keys

<!-- prettier-ignore -->
| Key | Type | Default |
|-|-|-|
| [`version`](#version) | integer, must be `1` | required |
| [`dialect`](#dialect) | integer, must be `1` | `1` |
| [`engine`](#engine) | semver range string | none |
| [`harnesses`](#harnesses) | object | `{}` |
| [`paths`](#paths) | object of strings | see below |
| [`sources`](#sources) | object of source paths | conventional source paths |
| [`skills`, `agents`, `rules`, `assets`](#entity-selection) | object | `{}` |
| [`mcp`](#mcp) | object | `{}` |
| [`profiles`](#profiles) | object of profiles | none |
| [`shared`](#shared) | object | see below |
| [`lint`](#lint) | object | see below |
| [`generated`](#generated) | object | `{ commit: false }` |
| [`hooks`](#hooks) | object | `{ postInstall: [] }` |

### version

The configuration format version. This engine only reads `1`; any other value fails with an "upgrade skillerie" message.

```yaml
version: 1
```

### dialect

The version of the [authoring dialect](authoring.md). Only `1` exists.

```yaml
dialect: 1
```

### engine

A semver range the running skillerie must satisfy. `validate`, `sync`, `install`, `status`, and `doctor` stop with an error when it doesn't. Supported syntax: exact versions, `^`, `~`, `>`, `>=`, `<`, `<=`, `x` and `*` wildcards, hyphen ranges (`1.2.0 - 1.4.0`), space-separated comparator sets, and `||`.

```yaml
engine: "^0.3"
```

`init` doesn't set this key. It pins the version in `package.json` instead.

### harnesses

One entry per harness you want to manage. A harness that isn't listed is not configured and nothing is rendered or installed for it.

```yaml
harnesses:
  opencode:
    enabled: true
  codex:
    enabled: true
    path: ~/.codex
  omo:
    enabled: true
  pi:
    enabled: false
```

<!-- prettier-ignore -->
| Key | Type | Default | Notes |
|-|-|-|-|
| `enabled` | boolean | `true` | `false` keeps the entry but skips the harness |
| `path` | string | see below | Install root (the harness home) |
| `options` | JSON object | `{}` | Harness-specific options |

Default `path` values:

<!-- prettier-ignore -->
| Harness | Default home |
|-|-|
| `opencode` | `$XDG_CONFIG_HOME/opencode`, or `~/.config/opencode` |
| `codex` | `$CODEX_HOME`, or `~/.codex` |
| `omo` | `~/.omo` |
| `pi` | `~/.pi/agent` |

OMO keeps agent content in a separate directory. Set it with `options.agentDir`; the default is `<path>/agent`, and the `OMO_CODING_AGENT_DIR` environment variable takes precedence over both. No other `options` keys are read today.

### sources

Use `sources` to select existing content without moving it. Its `skills`, `agents`, `rules`, `instructions`, `mcp`, `bin`, and `harnesses` fields accept paths relative to the repository root; variables expand before resolution, but absolute inputs and paths resolving outside the repository are rejected. Defaults are `skills/`, `agents/`, `rules/`, `instructions.md`, `mcp.json`, `bin/`, and `harnesses/`.

### paths

Named directories. Three names have a meaning to skillerie; you can add any others and use them as `${paths.<name>}`.

<!-- prettier-ignore -->
| Key | Default | Used for |
|-|-|-|
| `docs` | `~/docs` | Nothing internally; available as `${paths.docs}` |
| `backup` | `~/.Trash/skillerie` | Where install and uninstall move replaced files |
| `cache` | `$XDG_CACHE_HOME/skillerie/<hash>`, or `~/.cache/skillerie/<hash>` | Rendered generations; `<hash>` is the SHA-256 of the repository path |

Path values can reference each other through `${paths.<name>}`. A cycle is an error. The `SKILLERIE_BACKUP_DIR` environment variable overrides `backup`, and `generated.commit: true` overrides `cache`.

```yaml
paths:
  docs: ~/notes
  backup: ~/.local/share/skillerie/backups
  scripts: ${repo}/bin
```

### Entity selection

`skills`, `agents`, `rules`, and `assets` share the following selection keys. Skills also accept [`external`](#skillsexternal).

```yaml
skills:
  enabled: [] # allowlist; empty means "all"
  disabled: [legacy] # always wins
  overrides:
    release:
      requires: { bin: gh }
  harnesses:
    omo:
      disabled: [debug]
      overrides:
        review:
          disable-model-invocation: true
```

<!-- prettier-ignore -->
| Key | Type | Default | Meaning |
|-|-|-|-|
| `enabled` | list of names | `[]` | When nonempty, only these entities are selected |
| `disabled` | list of names | `[]` | These entities are never selected |
| `overrides` | map of name to [override](#overrides) | `{}` | Fields applied to the named entity |
| `harnesses.<harness>` | object with `enabled`, `disabled`, `overrides` | none | The same keys, for one harness |

For each harness, an entity is selected when:

1. It isn't harness-scoped to a different harness.
2. Its name isn't in the global or the per-harness `disabled` list.
3. Its override sets `enabled: true`, or, without that, the effective `enabled` list is empty or contains it. A nonempty per-harness `enabled` list replaces the global one. An override with `enabled: false` deselects it.

Every discovered asset is selected for its owning harness by default. Use `assets.enabled`, `assets.disabled`, `assets.overrides`, or `assets.harnesses.<harness>` to change that selection.

### skills.external

Load skills and their support files from git repositories:

```yaml
skills:
  external:
    - url: https://github.com/example/shared-skills
      ref: v1.2.0
      path: skills
      include: [review, release]
    - url: https://github.com/example/team-skills/tree/main/skills/debug
    - url: git@github.com:example/private-skills.git
      ref: stable
    - url: file:///home/alice/local-skills
```

<!-- prettier-ignore -->
| Key | Type | Default | Meaning |
|-|-|-|-|
| `url` | string | required | HTTPS or SSH git remote, `git@host:owner/repo.git`, `file://` repository, or GitHub repository/tree URL |
| `ref` | string | remote default branch | Tag, branch, or full 40-character commit SHA; overrides a tree URL's ref |
| `path` | string | repository root | Skill directory containing `SKILL.md`, or directory whose immediate subdirectories contain skills; overrides a tree URL's path |
| `include` | list of names | all | Directory names to select from a directory of skills; an unknown name is an error |

A GitHub `/tree/<ref>/<path>` URL supplies both the ref and path. Use an explicit `ref` for names containing slashes. Paths must stay inside the external repository. An omitted ref follows the remote's default branch ("latest"). Branches also follow upstream on each validation or install. Tags and full SHAs pin content. Short SHAs are rejected with a request for a tag, branch, or full SHA.

The engine uses your system `git` and passes through your environment for credentials. Checkouts are shallow, stored under `<paths.cache>/external/<host/owner/repo>/<sha>/`, and published atomically. An existing commit directory is reused without fetching. Ref resolution still queries the remote for tags and branches. When that query or fetch fails, a previously used commit for that exact entry is used with a warning; without cached content, resolution fails. A cached full SHA works without contacting the remote. Resolution may populate this cache during `validate` or a check command; harness homes are not changed.

External skills use the same selection, overrides, per-harness settings, `requires`, dialect conversion, and rendering as local skills. Their resolved commits enter the input snapshot and install manifest, so a moving branch changes the generation hash even if its skill files did not change.

Names must not collide with local skills or other external skills. Use `include` to select a noncolliding subset, or `skills.disabled` to exclude a conflicting name globally. Content lint is skipped for external skills: structure, description-prefix, questions, references, unknown frontmatter fields, and JSON support-file syntax produce no diagnostics. Missing `SKILL.md`, unparseable frontmatter, and missing or invalid `name` or `description` remain errors. References from local sources to external skills are still checked.

### Overrides

An override supplies fields for an entity from `skillerie.yaml`. Per-harness overrides are applied on top of global ones. Fields set in the entity's own frontmatter win over both, so overrides fill in what the source file leaves out. That makes them most useful for `requires` and for restrictions on shared skills you don't want to edit.

<!-- prettier-ignore -->
| Key | Type | Applies to |
|-|-|-|
| `enabled` | boolean | all; see selection above |
| `requires` | [requires](#requires) | all |
| `paths` | list of globs | rules |
| `allowed-tools` | string or list | skills |
| `disable-model-invocation` | boolean | skills |
| `license`, `compatibility` | string | skills |
| `metadata` | JSON object | skills |
| `name`, `description` | string | skills; required in frontmatter, so an override never takes effect |
| `argument-hint`, `user-invocable` | string, boolean | skills; fill omitted fields, with defaults of no hint and `true` |
| `allowed_tools` | string or list | agents |
| `skills` | list of names | agents |
| `maxTurns` | integer, at least 1 | agents |
| `readOnly`, `noShell` | boolean | agents |

Rules take only `paths` and `requires` from an override; assets take only `requires`.

### requires

Conditions an entity needs before it is rendered for a harness. Every listed condition must hold. Each kind takes a single value or a list.

<!-- prettier-ignore -->
| Key | Values | Holds when |
|-|-|-|
| `bin` | executable names or paths | Every executable is found on `PATH` (paths are resolved against the repository) |
| `env` | variable names | Every variable is set and nonempty |
| `os` | `darwin`, `linux` | The current platform is one of them |
| `harness` | `opencode`, `codex`, `omo`, `pi` | The harness being rendered is one of them |

```yaml
rules:
  overrides:
    deploy-checklist:
      requires: { bin: [kubectl, helm], os: linux }
```

Requirements are evaluated once per run and recorded in the input snapshot. Environment values are never recorded, only whether each check passed. Set `SKILLERIE_FORCE_<NAME>=1` or `=0` to force an entity on or off; `<NAME>` is the entity name upper-cased with hyphens turned into underscores (`SKILLERIE_FORCE_DEPLOY_CHECKLIST`).

When an entity is excluded for a harness, references to it from that harness's other content are reported by the `references` lint rule rather than dropped silently.

### mcp

Selects which servers from [`mcp.json`](#mcpjson) are rendered. It isn't the same key as `sources.mcp`, which only says where `mcp.json` lives.

```yaml
mcp:
  enabled: [] # allowlist; empty means "all"
  disabled: [tracker] # always wins
  harnesses:
    codex:
      disabled: [docs]
```

<!-- prettier-ignore -->
| Key | Type | Default | Meaning |
|-|-|-|-|
| `enabled` | list of server names | `[]` | When nonempty, only these servers are rendered |
| `disabled` | list of server names | `[]` | These servers are never rendered |
| `harnesses.<harness>` | object with `enabled`, `disabled` | none | The same keys, for one harness |

The rule is the same as [entity selection](#entity-selection), without overrides: a server is dropped when its name is in the global or the per-harness `disabled` list, and otherwise kept when the effective `enabled` list is empty or contains it. A nonempty per-harness `enabled` list replaces the global one. Selection applies to `mcpServers` and to the servers in `harnessOverrides`. Setting a server to `null` in `harnessOverrides.<harness>` still removes it for that harness.

### profiles

Profiles let one repository hold several setups, for example one for work and one for personal machines. Each profile changes the selection on top of the rest of `skillerie.yaml`.

```yaml
profiles:
  work:
    mcp: { enabled: [jira, datadog] }
    skills: { disabled: [personal-notes] }
  personal:
    harnesses: { codex: { enabled: false } }
    mcp: { disabled: [jira, datadog] }
    skills:
      harnesses:
        omo: { disabled: [debug] }
```

The first profile in the file is the default. Pass `--profile <name>` to `validate`, `sync`, `install`, `status`, `doctor`, `outdated`, or `uninstall` to use another one; see [install](install.md#profiles). Naming a profile that doesn't exist is a `config.profile.unknown` error that lists the available profiles, and so is passing `--profile` when the file has no `profiles`. Without `profiles`, nothing changes.

Profile names are lowercase tokens separated by single hyphens, and they must start with a letter (`work`, `client-2`). A profile may set:

<!-- prettier-ignore -->
| Key | Type | Meaning |
|-|-|-|
| `harnesses.<harness>.enabled` | boolean | Turns a harness on or off |
| `skills`, `agents`, `rules`, `assets` | [entity selection](#entity-selection) | `enabled`, `disabled`, `overrides`, and `harnesses.<harness>`; no `external` |
| `mcp` | [mcp selection](#mcp) | `enabled`, `disabled`, and `harnesses.<harness>` |

Paths, options, lint, hooks, and external skills can't be changed by a profile.

The selected profile is merged into the base configuration. For the global selection and for each `harnesses.<harness>` selection:

- `disabled` lists are combined. Disabled always wins, so a profile can't bring back a name the base disables.
- A nonempty `enabled` list in the profile replaces the base list. An empty or missing one keeps the base list.
- `overrides` are merged per name, and the profile's fields win.
- `harnesses.<harness>.enabled` from the profile replaces the base value. A profile can enable a harness that the base doesn't list; it gets the default path.

The install manifest records which profile was installed. When `status` runs with a different profile, it warns with `install.profile.mismatch` and tells you which `--profile` to pass.

### shared

<!-- prettier-ignore -->
| Key | Values | Default |
|-|-|-|
| `agentsSkillsDir` | `dedupe`, `preserve` | `dedupe` |

Some harnesses also load skills from `~/.agents/skills`, where a copy can shadow a managed skill. With `dedupe`, the OMO adapter adds an exclusion pattern for each managed skill (`!**/<name>/**`) to the `skills` array of OMO's `settings.json`. `preserve` leaves that file alone. `doctor` warns about shadowing entries in either mode.

### lint

Configurable semantic checks. Each rule has a `severity` of `error`, `warn`, `info`, or `off`. Errors stop `validate`, `sync`, and `install`; the other levels are reported only.

<!-- prettier-ignore -->
| Rule | Default severity | Checks |
|-|-|-|
| `descriptionPrefix` | `warn` | Every skill description starts with `value` (default `"Use when"`) |
| `structure` | `off` | Every skill body has an `Announce:` line, a `## Step N` heading, and a `## Error Handling` heading |
| `questions` | `error` | `AskUserQuestion(` appears only inside `<interaction>` blocks, and prose containing "ask the user" matches an `allowProse` entry |
| `references` | `error` | Every backticked `` `/name` `` reference in skills, agents, rules, and instructions, and every agent `skills` entry, names a skill available for that harness |

```yaml
lint:
  descriptionPrefix: { value: "Use when", severity: error }
  structure: { severity: warn }
  questions:
    allowProse: ["ask the user for the pull request number"]
  references: { severity: error }
```

`allowProse` entries are matched case-insensitively as substrings of the offending line. Fenced code blocks are skipped by the `questions` rule.

### generated

<!-- prettier-ignore -->
| Key | Type | Default |
|-|-|-|
| `commit` | boolean | `false` |

With `commit: true`, generations are written to `generated/` inside the repository instead of the cache directory, so you can commit and review rendered output. `init` adds `generated/` to `.gitignore`; remove that line if you opt in.

### hooks

<!-- prettier-ignore -->
| Key | Type | Default |
|-|-|-|
| `postInstall` | list of commands | `[]` |

Each entry is a shell command string. After a successful `install`, skillerie runs each command through the shell, in order, from the repository directory. The environment includes `SKILLERIE_REPO` (the repository path) and `SKILLERIE_HARNESSES` (comma-separated harnesses that were installed). Output is discarded.

```yaml
hooks:
  postInstall:
    - ./bin/refresh-index.sh
    - make -C ~/tools sync
```

Hooks don't run during `install --check`, or when any managed file was preserved as a user edit. A failing hook is reported as a warning and doesn't change the result of the install.

## mcp.json

MCP servers live in `mcp.json` at the repository root, in the common `mcpServers` shape, so you can paste vendor snippets unchanged.

```json
{
  "mcpServers": {
    "docs": { "url": "https://docs.example.com/mcp" },
    "tracker": {
      "command": "node",
      "args": ["${repo}/bin/tracker.js"],
      "env": { "TRACKER_URL": "https://tracker.example.com" }
    }
  },
  "harnessOverrides": {
    "pi": { "tracker": null },
    "codex": {
      "docs": { "url": "https://docs.example.com/mcp", "bearer_token_env_var": "DOCS_TOKEN" }
    }
  },
  "settings": {}
}
```

<!-- prettier-ignore -->
| Key | Type | Meaning |
|-|-|-|
| `mcpServers` | map of name to server | Servers for every harness |
| `harnessOverrides.<harness>` | map of name to server or `null` | Replaces a whole server for one harness; `null` removes it |
| `settings` | JSON object | Extra settings written into the OMO and Pi MCP files |

Use the [`mcp`](#mcp) key in `skillerie.yaml` to choose which of these servers are rendered. A server has `command` with optional `args` and `env`, or `url` with optional `headers`. Other fields are kept and passed to adapters that understand them; see the harness pages. Every string value supports [variables](#variables). Reference secrets through environment variables or files; don't inline them.

## Environment variables

<!-- prettier-ignore -->
| Variable | Effect |
|-|-|
| `HOME` | Base for `~`, `${home}`, and default paths |
| `XDG_CONFIG_HOME` | Default OpenCode home |
| `XDG_CACHE_HOME` | Default cache directory |
| `CODEX_HOME` | Default Codex home |
| `OMO_CODING_AGENT_DIR` | OMO agent directory |
| `SKILLERIE_BACKUP_DIR` | Overrides `paths.backup` |
| `SKILLERIE_FORCE_<NAME>` | `1` or `0` forces an entity's requirements on or off |
