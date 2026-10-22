# Writing an adapter

An adapter connects skillerie to one harness. It reads the resolved model, returns rendered files, and describes where they should be installed. It never writes to disk itself: the engine owns staging, ownership checks, backups, locking, journaling, and rollback. Adding a harness means adding one adapter, so this is the main way to extend skillerie.

The contract lives in `src/core/types.ts`. Import shared types from there.

## The Adapter interface

```ts
export interface Adapter {
  readonly id: HarnessId;
  readonly capabilities: Capabilities;
  readonly supportedRange: string;
  defaultPaths(env: Environment): HarnessPaths;
  render(ctx: ResolvedContext): Promise<RenderResult>;
  targets(ctx: ResolvedContext, generationDir: string): readonly Action[];
  check?(ctx: ResolvedContext): Promise<readonly Diagnostic[]>;
  doctor?(ctx: ResolvedContext): Promise<readonly Diagnostic[]>;
}
```

A module exports it as a named `adapter` constant. Adapters are loaded lazily, only when their harness is enabled.

### id

The harness identifier. Configuration version 1 accepts `opencode`, `codex`, `omo`, and `pi`, so a new harness also needs a new identifier in `HarnessId`, `HARNESS_IDS`, the CLI `--harness` choices, and the JSON Schema. The engine checks that a loaded adapter's `id` matches the harness it was registered under.

### supportedRange

A semver range of harness CLI versions the adapter targets, for example `">=1.1.0 <2.0.0"`. `doctor` runs `<id> --version`, extracts the version, and warns when it falls outside this range.

### capabilities

Plain data that drives the shared dialect conversions and restriction checks:

```ts
export const capabilities: Capabilities = {
  toolMap: { Read: "read", Bash: "shell", AskUserQuestion: "ask" },
  questionLimits: { maxHeaderLength: 20, maxOptions: 4, maxQuestions: 2, multiSelect: false },
  permissionEnforcement: { toolAllowlist: true, readOnly: false, noShell: true },
  nativeAgentReplacements: { Explore: "explorer" },
  supportsCommands: false,
  supportsRules: true,
};
```

<!-- prettier-ignore -->
| Field | Meaning |
|-|-|
| `toolMap` | Dialect tool name to native tool name. Used by `rewriteTools`. |
| `questionLimits` | Native question tool limits; `null` means no limit. Used by `enforceQuestionLimits`. |
| `permissionEnforcement` | Which agent restrictions the harness enforces at runtime |
| `nativeAgentReplacements` | Agent names that map to native agents. Used by `resolveAgentAlias`. |
| `supportsCommands`, `supportsRules` | Whether the harness has slash commands and rule files |

Be strict with `permissionEnforcement`. Set a flag only when the harness itself blocks the action. The engine turns every requested restriction the adapter can't enforce into a diagnostic: a warning for `allowed_tools`, an error for `readOnly` and `noShell`. Telling the model "don't use the shell" in a prompt is not enforcement.

### defaultPaths(env)

Returns the harness's directories from the environment, without touching the filesystem:

```ts
export interface HarnessPaths {
  readonly home: string;
  readonly configDir: string;
  readonly skillsDir: string;
  readonly agentsDir: string;
  readonly rulesDir: string;
  readonly assetsDir: string;
  readonly commandsDir?: string;
}
```

The engine moves every path under the configured `harnesses.<id>.path` by keeping it relative to `home`, and passes the result as `ctx.paths`.

### render(ctx)

Produces the generation for this harness. It must be a pure function of `ctx`: don't read the environment, probe binaries, or write files.

```ts
export interface ResolvedContext {
  readonly snapshot: InputSnapshot;
  readonly model: SourceModel;
  readonly harness: HarnessId;
  readonly paths: HarnessPaths;
  readonly harnessVersion: HarnessVersionInfo;
  readonly env: Environment;
}
```

Use `ctx.model.harnesses[id]` for skills, agents, rules, and assets. Those are effective copies: selection, overrides, and `requires` have already been applied for this harness, so don't repeat that logic. The top-level `ctx.model.skills` and friends hold the full inventory, which is useful for diagnostics about excluded entities. Templates, seeds, instructions, and MCP configuration are on `ctx.model` too; use `resolveMcpServers(mcp, id)` from `src/model/index.ts` to apply per-harness overrides.

Return:

```ts
export interface RenderResult {
  readonly files: readonly RenderedFile[];
  readonly diagnostics: readonly Diagnostic[];
  readonly metadata: JsonObject;
}
```

Each `RenderedFile` has a `relPath`, a `mode` (POSIX permission bits), and either `kind: "file"` with text or bytes, or `kind: "symlink"` with a target string. Paths are relative to the harness's own generation directory. The engine prefixes them with the adapter id and rejects absolute paths, `..` segments, backslashes, empty segments, and duplicates. Diagnostics without a location are attributed to `/harnesses/<id>` in `skillerie.yaml`.

### targets(ctx, generationDir)

Describes installation without performing it. `generationDir` is the stable `<cache>/current` path, so links built from it keep working after the next generation is activated. Your files live under `join(generationDir, id)`.

<!-- prettier-ignore -->
| Action | Fields | Behavior |
|-|-|-|
| `link` | `source`, `target` | Symlink `target` to `source` |
| `copy` | `source`, `target` | Copy `source` to `target`; owned by skillerie |
| `seed` | `source`, `target` | Copy only if `target` is missing; then owned by the user |
| `exclusiveTree` | `source`, `target`, `preserve` | Make `target` a directory of links to the entries of `source`, removing anything else except relative paths in `preserve` |
| `mergeBlock` | `target`, `format`, `blockId`, `content` | Place `content` between `skillerie:<blockId>` markers in a user file; `format` is `toml`, `json`, or `text` |
| `jsonArrayMerge` | `target`, `jsonPath`, `blockId`, `values` | Append unique values to the array at an RFC 6901 pointer |

All paths must be absolute. Targets can't overlap, except that several merge actions may share one file. Targets can't sit inside `.skillerie/` or the backup directory, and a source can't sit inside its own target.

### check(ctx) and doctor(ctx)

Both are optional and must not change any installation. `skillerie doctor` calls both for each enabled harness, with `ctx.harnessVersion` filled in from the probe. `check` validates the rendered configuration headlessly through the harness CLI and runs only when that CLI is on `PATH`; `doctor` reports any other environment findings.

## Shared dialect helpers

`src/dialect/index.ts` exports the parsing and rewriting steps. An adapter composes them and supplies the native output shapes:

<!-- prettier-ignore -->
| Helper | Purpose |
|-|-|
| `convertInteractionBlocks(text, options)` | Replace `<interaction>` blocks using `options.renderQuestions` |
| `parseStructuredCalls(text, options)` | Find `Task`, `Agent`, `Skill`, and `AskUserQuestion` calls with their spans |
| `normalizeQuestions(call, options)` | Turn a question call into a `QuestionModel` |
| `enforceQuestionLimits(model, limits, options)` | Apply `questionLimits` |
| `rewriteTools(text, options)` | Translate tool and agent names in backticks and call position |
| `rewriteMcpRefs(text, options)` | Rename `mcp__server__tool`, optionally through `options.mcpTemplate` |
| `rewriteArguments(text, options)` | Keep or replace `$ARGUMENTS` outside fenced code |
| `rewritePluginRoot(text, options)` | Rewrite `${CLAUDE_PLUGIN_ROOT}` to `./` |
| `resolveAgentAlias(name, options)` | Map an agent name through `nativeAgentReplacements` |

Every helper returns `{ text, diagnostics }`. Collect the diagnostics into your `RenderResult`. The built-in adapters in `src/adapters/*/` show different ways to compose them; `src/adapters/pi/markdown.ts` is a compact example.

## Registering

Add a loader to `ADAPTERS` in `src/adapters/index.ts`:

```ts
["myharness", () => import("./myharness/index.js")],
```

## Testing

Each built-in adapter has tests under `test/adapters/<id>/`, including a golden test that renders the synthetic repository in `test/fixtures/sample-repo/` through the real engine and compares the result with `test/golden/<id>/`. Follow the same pattern:

- unit tests for conversions and restriction diagnostics;
- a golden test for the full rendered tree, with temporary paths normalized;
- tests for `targets` against a temporary home.

Use neutral fixtures only: `example.com` URLs, generic server names, and temporary directories. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` before opening a pull request.
