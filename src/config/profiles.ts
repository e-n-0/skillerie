import type {
  Diagnostic,
  EntitySelection,
  HarnessId,
  JsonObject,
  ResolvedHarnessConfig,
} from "../core/types.js";
import type { ConfigInput, EntityInput, McpSelectionInput } from "./input.js";

type SelectionInput = Partial<EntitySelection>;
type ListsInput = Pick<SelectionInput, "enabled" | "disabled">;
const harnessIds = ["opencode", "codex", "omo", "pi"] as const;

export interface ProfileResult {
  readonly config?: ConfigInput & JsonObject;
  readonly profile?: string;
  readonly diagnostics: readonly Diagnostic[];
}

function mergeLists(base: ListsInput = {}, profile: ListsInput = {}) {
  return {
    enabled: profile.enabled?.length ? profile.enabled : (base.enabled ?? []),
    disabled: [...new Set([...(base.disabled ?? []), ...(profile.disabled ?? [])])],
  };
}

function mergeSelection(base: SelectionInput = {}, profile: SelectionInput = {}): EntitySelection {
  return {
    ...mergeLists(base, profile),
    overrides: Object.fromEntries(
      Object.entries({ ...base.overrides, ...profile.overrides }).map(([name, fields]) => [
        name,
        { ...base.overrides?.[name], ...fields },
      ]),
    ),
  };
}

function mergeEntities(base: EntityInput = {}, profile: EntityInput = {}): EntityInput {
  const harnesses: Partial<Record<HarnessId, EntitySelection>> = {};
  for (const name of harnessIds) {
    if (base.harnesses?.[name] === undefined && profile.harnesses?.[name] === undefined) continue;
    harnesses[name] = mergeSelection(base.harnesses?.[name], profile.harnesses?.[name]);
  }
  return { ...mergeSelection(base, profile), harnesses };
}

function mergeMcp(
  base: McpSelectionInput = {},
  profile: McpSelectionInput = {},
): McpSelectionInput {
  const harnesses: Partial<Record<HarnessId, ListsInput>> = {};
  for (const name of harnessIds) {
    if (base.harnesses?.[name] === undefined && profile.harnesses?.[name] === undefined) continue;
    harnesses[name] = mergeLists(base.harnesses?.[name], profile.harnesses?.[name]);
  }
  return { ...mergeLists(base, profile), harnesses };
}

/** Choose a profile in file order and merge it before paths or variables are resolved. */
export function applyProfile(input: ConfigInput & JsonObject, requested?: string): ProfileResult {
  const { profiles, ...base } = input;
  const name = requested ?? Object.keys(profiles ?? {})[0];
  if (name === undefined) return { config: base, diagnostics: [] };
  if (profiles === undefined) {
    return {
      diagnostics: [
        {
          severity: "error",
          code: "config.profile.unknown",
          message: `Profile "${name}" is not defined; skillerie.yaml has no profiles.`,
          jsonPath: "",
        },
      ],
    };
  }
  const profile = Object.hasOwn(profiles, name) ? profiles[name] : undefined;
  if (profile === undefined) {
    return {
      diagnostics: [
        {
          severity: "error",
          code: "config.profile.unknown",
          message: `Unknown profile "${name}". Available profiles: ${Object.keys(profiles).join(", ")}.`,
          jsonPath: "/profiles",
        },
      ],
    };
  }

  const harnesses: Partial<Record<HarnessId, Partial<ResolvedHarnessConfig>>> = {
    ...base.harnesses,
  };
  for (const harness of harnessIds) {
    const settings = profile.harnesses?.[harness];
    if (settings !== undefined) harnesses[harness] = { ...base.harnesses?.[harness], ...settings };
  }
  const config = Object.assign({}, base, {
    harnesses,
    ...(base.skills || profile.skills
      ? { skills: { ...base.skills, ...mergeEntities(base.skills, profile.skills) } }
      : {}),
    ...(base.agents || profile.agents
      ? { agents: mergeEntities(base.agents, profile.agents) }
      : {}),
    ...(base.rules || profile.rules ? { rules: mergeEntities(base.rules, profile.rules) } : {}),
    ...(base.assets || profile.assets
      ? { assets: mergeEntities(base.assets, profile.assets) }
      : {}),
    ...(base.mcp || profile.mcp ? { mcp: mergeMcp(base.mcp, profile.mcp) } : {}),
  });
  return { config, profile: name, diagnostics: [] };
}
