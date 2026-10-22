# Pi

Supported versions: `>=0.85.0`.

Home: `harnesses.pi.path`, or `~/.pi/agent`.

## What gets installed

<!-- prettier-ignore -->
| Path in the home | Kind | Content |
|-|-|-|
| `settings.json` | link | Your template, or `{ "enableSkillCommands": true }` |
| `mcp.json` | link | MCP servers |
| `AGENTS.md` | link | `instructions.md` followed by every rule |
| `skills/` | exclusive tree | One directory per skill |
| `agents/` | exclusive tree | One Markdown agent per source agent, plus `general-purpose.md` |
| `extensions/` | exclusive tree | Filled by an asset named `extensions` |

Discovered assets are selected automatically; use `assets` entity selection to exclude them. Pi only installs selected assets named `extensions` (or under `extensions/`); other assets are ignored. A `settings.json` template controls Pi settings.

## mcp.json

Pi gets its own `mcp.json` with `mcpServers` (Pi overrides applied) and, when your repository's `mcp.json` has a nonempty `settings` object, a `settings` key. Server entries are written as they appear in your source, so Pi's MCP support handles transport and authentication.

An optional `harnesses/pi/templates/mcp.json` may provide a top-level `settings` object, which is copied into the rendered `mcp.json`.
Its optional `serverDefaults` object is shallow-merged into every rendered server entry, with per-server values taking precedence.

## Skills

Each skill's frontmatter keeps `name`, `description`, and `disable-model-invocation`. Skill references are rewritten from `` `/name` `` to `` `/skill:name` ``. `$ARGUMENTS` is kept as written. MCP references become `mcp({tool:"<server>_<tool>",args:"..."})` calls, `Task` and `Agent` calls become `subagent` calls, and `Skill` calls become an instruction to read and follow the named skill.

## Agents

Each agent becomes `agents/<name>.md` with `name`, `description`, `tools`, `skills`, and `maxTurns`. Pi enforces tool selection:

- `allowed_tools` becomes the `tools` list. Dialect names are translated, any `mcp__...` entry becomes `mcp`, and orchestration tools (`Task`, `Agent`, `Skill`, `AskUserQuestion`) are dropped. Scoped entries such as `Bash(git:*)` grant the whole tool, so they produce a warning.
- `noShell` removes `bash` from the list, or from the default tool set when `allowed_tools` isn't given.
- `readOnly` can't be enforced and is an error.

Every agent ends with a note to return questions to the parent agent, because Pi child agents have no question tool. A `general-purpose` agent is always generated with the tools `read, write, edit, grep, find, bash, mcp, web_search`. A source agent named `general-purpose` is ignored, and is an error if it declares `allowed_tools` or `noShell`.

## Questions

`AskUserQuestion` blocks become `ask_user_question` calls, with headers of 16 characters, up to 4 options, and up to 4 questions. multiSelect is supported.
