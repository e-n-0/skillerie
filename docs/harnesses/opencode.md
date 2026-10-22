# OpenCode

Supported versions: `>=1.1.0 <2.0.0`.

Home: `harnesses.opencode.path`, or `$XDG_CONFIG_HOME/opencode`, or `~/.config/opencode`.

## What gets installed

<!-- prettier-ignore -->
| Path in the home | Kind | Content |
|-|-|-|
| `opencode.jsonc` | link | Your template merged with MCP servers and rule instructions |
| `AGENTS.md` | link | `instructions.md`, when present |
| `skills/` | exclusive tree | One directory per skill |
| `agents/` | exclusive tree | One Markdown agent per source agent |
| `commands/` | exclusive tree | One command per skill with `user-invocable: true` |
| `rules/` | exclusive tree | One file per rule |
| `plugins/` | exclusive tree | Filled by an asset named `plugins` |

Discovered assets are selected automatically; use `assets` entity selection to exclude them. Other templates and file assets are linked into the home under their own names. Directory assets become exclusive trees at `<home>/<asset name>`.

## opencode.jsonc

Put your settings in `harnesses/opencode/templates/opencode.jsonc`. JSONC comments and trailing commas are allowed. skillerie validates the template against a bundled copy of the OpenCode config schema, then:

- adds each server from `mcp.json` under `mcp`, as `{ type: "remote", url, headers }` for URL servers or `{ type: "local", command: [command, ...args], environment }` for command servers (a leading `~/` in the command or its arguments is expanded);
- adds `"rules/*.md"` to `instructions` when there is at least one rule;
- validates the result again and writes it with a "generated" header comment.

Model identifiers aren't checked against a catalog, so custom providers work. Declaring a server in both the template's `mcp` section and `mcp.json` is an error. For URL servers, an `oauth.clientId` field in `mcp.json` is passed through as `oauth: { clientId }`.

## Skills and commands

Each skill's frontmatter is reduced to `name`, `description`, `license`, and `compatibility`, followed by short guidance about support paths and `$ARGUMENTS`. `$ARGUMENTS` is kept as written. Skills get `commands/<name>.md` unless `user-invocable: false`; the command loads the skill and passes the invocation context.

## Agents

Agents are written as `mode: subagent` Markdown files. `maxTurns` becomes `steps`. `allowed_tools` becomes a `permission` map that denies every built-in tool not on the list; MCP tools in the list are allowed through, and an unknown tool name is an error. Because OpenCode can't deny arbitrary plugin or MCP tools this way, the engine includes OpenCode in its single guidance-only warning per agent. `noShell` denies both `bash` and `task`, so a child agent can't run the shell on its behalf. `readOnly` can't be enforced and is an error. Agents with `skills` are told to load them before starting.

## Rules

Each rule becomes `rules/<name>.md`, with its `paths` kept as frontmatter.

## Questions

`AskUserQuestion` blocks become calls to the `question` tool. Headers are cut to 30 characters; options and question counts are unlimited, and multiSelect is supported.
