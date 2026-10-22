# Codex

Supported versions: `>=0.160.0 <1.0.0`.

Home: `harnesses.codex.path`, or `$CODEX_HOME`, or `~/.codex`.

## What gets installed

<!-- prettier-ignore -->
| Path in the home | Kind | Content |
|-|-|-|
| `AGENTS.md` | link | `instructions.md` followed by every rule |
| `skills/` | exclusive tree | One directory per skill; `skills/.system` is preserved |
| `agents/` | exclusive tree | One TOML file per agent, plus `general-purpose.toml` |
| `config.toml` | managed blocks | Settings from your template and the MCP servers |

Other templates are linked into the home under their own names. Seeds from `harnesses/codex/seeds/` are copied into the home when missing.

Discovered assets are selected automatically and linked file by file; use `assets` entity selection to exclude them. Files ending in `.rules` are placed under `rules/` (Codex exec policy rules); everything else keeps its path relative to the home.

## config.toml

`~/.codex/config.toml` stays your file. skillerie writes two managed regions into it, `codex.settings` and `codex.mcp`, each split into a part before the first table and a part at the end, between comments like:

```toml
# skillerie:codex.settings.root:begin
approval_policy = "on-request"
# skillerie:codex.settings.root:end
```

The settings block comes from `harnesses/codex/templates/config.toml`. The MCP block is a `[mcp_servers.<name>]` table per server in `mcp.json`, each with `default_tools_approval_mode = "auto"`:

- command servers get `command`, `args`, and `env`;
- URL servers get `url`, plus `bearer_token_env_var`, `oauth_resource`, and `oauth.client_id` when the server defines them (camelCase spellings are accepted too).

Defining `mcp_servers` in the template is an error; keep servers in `mcp.json`. If servers declare an OAuth callback port or URL, skillerie sets `mcp_oauth_callback_port` and `mcp_oauth_callback_url`; all servers must agree on one value. When a server is removed from `mcp.json`, the next install removes it from the managed block.

## Skills

Each skill's frontmatter is reduced to `name` and `description`. skillerie also writes `skills/<name>/agents/openai.yaml` with a display name, a short description, and a default prompt derived from the description. `disable-model-invocation: true` sets `policy.allow_implicit_invocation: false` there. `$ARGUMENTS` is replaced with "the user's invocation prompt".

## Agents

Each agent becomes `agents/<name>.toml` with `name`, `description`, and `developer_instructions`. Codex can't enforce agent restrictions: `allowed_tools` is guidance only, and the engine includes Codex in its single warning per agent. `readOnly` and `noShell` are errors and the agent isn't rendered. A `general-purpose` agent is always generated, replacing any source agent with that name.

## Questions

`AskUserQuestion` blocks become `request_user_input` calls, with a note on falling back to a plain-text question when the tool isn't available (for example, in exec mode). Codex allows at most 3 questions per block and 3 options per question, and headers of 12 characters. Extra options move into the question text, and multiSelect questions are asked one choice per round.
