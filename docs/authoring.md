# Authoring skills, agents, and rules

Sources are written once in a shared Markdown dialect (`dialect: 1`). Each adapter translates that dialect into what its harness understands: tool names, question tools, agent names, argument placeholders, and paths. This page describes the dialect and what each harness does with it.

## Names

Skill, agent, and rule names are lowercase tokens joined by hyphens, at most 64 characters (`release-notes`, `code-review`). The name comes from the location:

- a skill is the directory holding `SKILL.md`, so `skills/release-notes/SKILL.md` is `release-notes`;
- an agent or rule is the file name without `.md`.

A `name` field in frontmatter must match. Names must be unique within each kind, compared case-insensitively. Only files directly under `rules/` are rules; subdirectories are ignored.

A single external skill can live at a repository root; its name comes from frontmatter rather than the checkout directory. Skills in an external collection follow the same directory-name rule as local skills.

Sources must be regular files and directories. A symlink anywhere in a source tree is an error. `.git`, `.DS_Store`, `__pycache__`, and `*.pyc`/`*.pyo` are skipped.

## Skill frontmatter

```markdown
---
name: release-notes
description: Use when the user wants release notes drafted from merged pull requests.
argument-hint: "[version]"
user-invocable: true
allowed-tools: [Read, Grep, Bash]
---
```

<!-- prettier-ignore -->
| Field | Type | Required | Notes |
|-|-|-|-|
| `name` | string | yes | Must match the directory name |
| `description` | string | yes | Whitespace is collapsed; longer than 1024 characters is trimmed at a sentence boundary |
| `argument-hint` | string | no | No hint by default; shown by harnesses that support it |
| `user-invocable` | boolean | no | Defaults to `true`; OpenCode also gets a `/name` command |
| `allowed-tools` | string or list | no | Tool names in the dialect |
| `disable-model-invocation` | boolean | no | Asks the harness not to pick the skill on its own |
| `license` | string | no | |
| `compatibility` | string | no | |
| `metadata` | object | no | |
| `requires` | object | no | See [requires](config.md#requires) |

Unknown fields are dropped. Local skills produce a warning; external skills skip content lint, including unknown-field warnings.

Everything else in the skill directory is a support file: references, scripts, templates, data. Support files are copied with their permissions. Markdown support files (`*.md`) go through the same dialect translation as `SKILL.md`; other files are copied byte for byte. A nested directory that has its own `SKILL.md` is a separate skill and isn't copied as support.

## Agent frontmatter

```markdown
---
name: reviewer
description: Reviews a change for correctness and missing tests.
skills: [code-review]
maxTurns: 20
noShell: true
---
```

<!-- prettier-ignore -->
| Field | Type | Required | Notes |
|-|-|-|-|
| `name` | string | yes | Must match the file name |
| `description` | string | yes | Same normalization as skills |
| `allowed_tools` | string or list | no | Tool allowlist; a comma-separated string also works |
| `skills` | list of names | no | Skills the agent loads before starting |
| `maxTurns` | integer, at least 1 | no | |
| `readOnly` | boolean | no | Hard restriction; see below |
| `noShell` | boolean | no | Hard restriction; see below |
| `requires` | object | no | See [requires](config.md#requires) |

Agent fields use snake_case (`allowed_tools`); skill fields use kebab-case (`allowed-tools`).

Restrictions are checked against what each harness can enforce at runtime. Prompt text never counts as enforcement.

<!-- prettier-ignore -->
| Restriction | OpenCode | Codex | OMO | Pi |
|-|-|-|-|-|
| `allowed_tools` | warning, guidance only | warning, guidance only | warning, guidance only | enforced |
| `noShell` | enforced | error | error | enforced |
| `readOnly` | error | error | error | error |

The engine emits one `engine.permission.unenforced` warning per agent, listing all enabled harnesses where its `allowed_tools` list is guidance only. The agent is still rendered. An error stops `validate` for that harness. To keep such an agent elsewhere, exclude it for that harness under `agents.harnesses.<harness>.disabled`.

## Rule frontmatter

Rules need no frontmatter. Optional fields:

<!-- prettier-ignore -->
| Field | Type | Notes |
|-|-|-|
| `name` | string | Must match the file name |
| `paths` | list of globs | Files the rule is about |
| `requires` | object | See [requires](config.md#requires) |

OpenCode keeps `paths` as frontmatter on the rule file. Codex and Pi add an "Applies to" line, and OMO keeps a small frontmatter block inside its `AGENTS.md`.

## Instructions

`instructions.md` is plain Markdown. Each adapter writes it, followed by the rules, into the harness's global `AGENTS.md` (OpenCode keeps rules as separate files). It goes through the dialect translation, and its `` `/name` `` references are linted.

## Tool names

Write tool names the way Claude Code spells them: `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`, `WebSearch`, `WebFetch`, `Task`, `Agent`, `Skill`, `AskUserQuestion`, `TodoWrite`. A name is translated only when it appears in backticks (`` `Read` ``) or in call position (`Read(`). Plain prose is never rewritten.

<!-- prettier-ignore -->
| Dialect | OpenCode | Codex | OMO | Pi |
|-|-|-|-|-|
| `Read` | `read` | `exec_command` | `read` | `read` |
| `Write` | `write` | `apply_patch` | `write` | `write` |
| `Edit` | `edit` | `apply_patch` | `edit` | `edit` |
| `MultiEdit` | | `apply_patch` | | `edit` |
| `Bash` | `bash` | `exec_command` | `bash` | `bash` |
| `Grep` | `grep` | `exec_command` | `bash` | `grep` |
| `Glob` | `glob` | `exec_command` | `bash` | `find` |
| `LS` | | `exec_command` | | `ls` |
| `WebSearch` | `websearch` | `web.run` | `web_search` | `web_search` |
| `WebFetch` | `webfetch` | `web.run` | `webfetch` | `web_search` |
| `Task`, `Agent` | `task` | `spawn_agent` | `task` | `subagent` |
| `Skill` | `skill` | | `read` | |
| `AskUserQuestion` | `question` | `request_user_input` | `ask_user_question` | `ask_user_question` |
| `TodoWrite` | `todowrite` | `update_plan` | `todo` | |

An empty cell means the name is left as written.

### MCP tools

Refer to an MCP tool as `mcp__<server>__<tool>`. Adapters rename it:

<!-- prettier-ignore -->
| Harness | `mcp__docs__search` becomes |
|-|-|
| OpenCode | `docs_search` |
| Codex | `docs_search` |
| OMO | `mcp_docs_search`, keeping any call arguments |
| Pi | `mcp({tool:"docs_search",args:"..."})`, with hyphens in the server name turned into underscores |

### Agent names

Agent names in backticks and in `Task`/`Agent` calls are resolved per harness. A namespace prefix (`plugin:explorer`) is dropped. Some names map to native agents:

<!-- prettier-ignore -->
| Harness | Built-in replacements |
|-|-|
| OpenCode | `Explore` to `explore`, `general-purpose` to `general` |
| Codex | `Explore` to `explorer`, `Plan` to `default` |
| OMO | `Explore` to `explore` |
| Pi | `Explore` to `explorer` |

Codex and Pi always get a generated `general-purpose` agent.

## Structured calls

`Task(...)`, `Agent(...)`, `Skill(...)`, and `AskUserQuestion(...)` written with named arguments are parsed and rewritten as native calls. Arguments use `key: value` (or `key = value`), optionally wrapped in braces. Values can be strings, numbers, booleans, `null`, arrays, objects, or bare expressions that the harness fills in at runtime.

```text
Task(subagent_type: "reviewer", description: "Review the diff", prompt: "Review the staged changes.")
Skill(skill: "release-notes", args: "1.4.0")
```

<!-- prettier-ignore -->
| Call | Accepted fields |
|-|-|
| `Task`, `Agent` | `subagent_type`, `prompt`, `description`, `model`, `resume`, `command`, `run_in_background` |
| `Skill` | `skill`, `args` |
| `AskUserQuestion` | `questions`, `header`, `question`, `options`, `multiSelect` |

An unknown field, unbalanced parentheses, or arguments that don't parse are errors. A call name followed by a space and then plain prose, as in "the Task (see below)", isn't treated as a call.

## Questions

Questions for the user go in an interaction block that contains exactly one `AskUserQuestion` call:

```text
<interaction>AskUserQuestion(
  header: "Scope",
  question: "Which branch should the release notes cover?",
  options: [
    { label: "main", description: "Everything merged to main since the last tag" },
    { label: "release", description: "Only the release branch" }
  ]
)</interaction>
```

Each adapter replaces the block with its native question tool. A call can use the flat fields shown above or a `questions: [...]` array of objects with the same fields. An option can be a `{ label, description }` object, a plain string, a `["label", "description"]` pair, or `"label" -- description`. If `options` is a runtime expression, the adapter asks the agent to fill in real choices before asking.

Harness limits are applied automatically:

<!-- prettier-ignore -->
| Harness | Header length | Options | Questions per block | multiSelect |
|-|-|-|-|-|
| OpenCode | 30 | no limit | no limit | yes |
| Codex | 12 | 3 | 3 | no |
| OMO | 12 | 4 | 4 | yes |
| Pi | 16 | 4 | 4 | yes |

Long headers are shortened at a word boundary. Extra options are moved into the question text as "Additional choices". Without multiSelect support, the question gets a note to pick one choice per round. More questions than the limit is an error, so split the block. Codex output also explains how to fall back to a plain-text question when `request_user_input` isn't available.

The `questions` lint rule reports `AskUserQuestion(` outside an interaction block, and prose that says "ask the user" unless it matches `lint.questions.allowProse`. Blocks inside fenced code or inline code are treated as examples and left untouched.

Child agents on OpenCode, OMO, and Pi are told to hand questions back to the parent agent, because those harnesses don't give child agents a question tool.

## Skill references

Refer to another skill as a backticked slash name: `` `/release-notes` ``. The `references` lint rule checks every such reference, and every agent `skills` entry, against the skills available for each harness. Pi rewrites references to `` `/skill:release-notes` ``; the other harnesses keep them as written.

## $ARGUMENTS

`$ARGUMENTS` stands for whatever the user passed when invoking the skill.

<!-- prettier-ignore -->
| Harness | Result |
|-|-|
| OpenCode | Kept; the skill gets a note explaining it |
| Codex | Replaced with "the user's invocation prompt" |
| OMO | Replaced with "the invocation arguments" |
| Pi | Kept |

Occurrences inside fenced code blocks are never replaced.

## Skill-relative paths

Use `${CLAUDE_PLUGIN_ROOT}` (or `$CLAUDE_PLUGIN_ROOT`) to point at files shipped with a skill. Every adapter rewrites it to `./`, relative to the installed skill directory, and drops the skill's own source path if it follows:

```text
${CLAUDE_PLUGIN_ROOT}/scripts/collect.sh                      -> ./scripts/collect.sh
${CLAUDE_PLUGIN_ROOT}/skills/release-notes/scripts/collect.sh -> ./scripts/collect.sh
```

## Harness-scoped content

Put a skill or agent under `harnesses/<harness>/skills/` or `harnesses/<harness>/agents/` to render it for that harness only. It follows the same rules as shared content, and its name must still be unique among all skills or agents.
