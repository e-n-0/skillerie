# OMO

Supported versions: `>=5.0.0 <6.0.0`.

OMO splits its files across two directories:

<!-- prettier-ignore -->
| Directory | Default | Override |
|-|-|-|
| Home (runtime configuration) | `~/.omo` | `harnesses.omo.path` |
| Agent directory | `<home>/agent` | `harnesses.omo.options.agentDir`, then the `OMO_CODING_AGENT_DIR` environment variable |

## What gets installed

<!-- prettier-ignore -->
| Path | Kind | Content |
|-|-|-|
| `<home>/omo.jsonc` | link | Your template with generated agents merged in |
| `<agent dir>/AGENTS.md` | link | `instructions.md` followed by every rule (see [Instructions](#instructions)) |
| `<agent dir>/mcp.json` | link | MCP servers |
| `<agent dir>/skills/` | exclusive tree | One directory per skill |
| `<agent dir>/models.json` | link | Only when you provide a `models.json` template |
| `<agent dir>/settings.json` | JSON array merge | Skill exclusions, with `shared.agentsSkillsDir: dedupe` |

Seeds from `harnesses/omo/seeds/` are copied into the agent directory when missing. Discovered assets are selected automatically and linked into the agent directory under their own names; use `assets` entity selection to exclude them.

## omo.jsonc

Put your settings in `harnesses/omo/templates/omo.jsonc`. Every source agent is written into `"[native]".agents`. You can still set fields for a generated agent in the template's `"[native]".agents.<name>`, and they're merged over the generated entry, but setting its `prompt` or `description` there is an error. Template entries for agents skillerie doesn't generate are kept as they are.

Use `agents.harnesses.omo.disabled` to keep an agent out of OMO.

Generated agents get `description`, `prompt`, and `max_turns` (from `maxTurns`). The prompt starts with a few notes: inherit the parent model, pass questions to the parent, and read the listed `skills` first.

## Instructions

OMO also loads `~/.config/opencode/AGENTS.md` as a user rule. When the opencode harness is enabled with its default path, that file already holds `instructions.md`, so OMO's `AGENTS.md` contains only the rules. Otherwise it starts with `instructions.md`.

## mcp.json

`<agent dir>/mcp.json` contains your `harnesses/omo/templates/mcp.json` template (if any), the `settings` object from your repository's `mcp.json`, and `mcpServers` with OMO overrides applied. A leading `~/` in a server's `command` or `args` is expanded.

## Skills

Each skill's frontmatter keeps `name`, `description`, `license`, `compatibility`, and `disable-model-invocation`. The body starts with a provenance comment and short guidance: where the source directory is, and, when the skill mentions MCP tools, a reminder to discover them first. `$ARGUMENTS` is replaced with "the invocation arguments". `Skill(...)` calls become an instruction to read the installed `SKILL.md` with the `read` tool.

## Skill deduplication

With `shared.agentsSkillsDir: dedupe` (the default), skillerie appends `!**/<name>/**` for each managed skill to the `skills` array in `<agent dir>/settings.json`, so copies elsewhere don't shadow managed skills. Only those entries are removed on uninstall. Set `preserve` to leave the file alone.

## Restrictions and questions

OMO enforces none of the agent restrictions: `allowed_tools` is guidance only, and the engine includes OMO in its single warning per agent. `readOnly` and `noShell` are errors. `AskUserQuestion` blocks become `ask_user_question` calls, with headers of 12 characters, up to 4 options, and up to 4 questions.
