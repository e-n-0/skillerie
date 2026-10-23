import { resolve } from "node:path";
import type {
  Environment,
  HarnessId,
  McpSelection,
  ResolvedConfig,
  ResolvedHarnessConfig,
} from "../core/types.js";
import type { ConfigInput } from "./input.js";
import { entitySettings } from "./input.js";
import type { LoadedConfig } from "./sources.js";
import type { resolvePaths } from "./paths.js";
import { expandVariables } from "./variables.js";

export function normalizeConfig(
  input: ConfigInput & Pick<ResolvedConfig, "profile">,
  resolution: ReturnType<typeof resolvePaths>,
  env: Environment,
): LoadedConfig {
  const paths = resolution.paths;
  const harnesses: Partial<Record<HarnessId, ResolvedHarnessConfig>> = {};
  const defaults = {
    opencode: `${env["XDG_CONFIG_HOME"] || `${paths.home}/.config`}/opencode`,
    codex: env["CODEX_HOME"] || `${paths.home}/.codex`,
    omo: `${paths.home}/.omo`,
    pi: `${paths.home}/.pi/agent`,
  };
  for (const name of ["opencode", "codex", "omo", "pi"] as const) {
    const value = input.harnesses?.[name];
    if (value === undefined) continue;
    const path = resolve(
      paths.repo,
      value.path ?? expandVariables(defaults[name], { ...paths, paths }).value,
    );
    const options = { ...value.options };
    if (name === "omo") {
      const configured = options["agentDir"];
      const agentDir = env["OMO_CODING_AGENT_DIR"];
      options["agentDir"] = resolve(
        paths.repo,
        agentDir
          ? agentDir.replace(/^~/, () => paths.home)
          : typeof configured === "string"
            ? configured
            : `${path}/agent`,
      );
    }
    harnesses[name] = {
      enabled: value.enabled ?? true,
      path,
      options,
    };
  }
  const mcp: McpSelection | undefined =
    input.mcp === undefined
      ? undefined
      : {
          enabled: input.mcp.enabled ?? [],
          disabled: input.mcp.disabled ?? [],
          harnesses: Object.fromEntries(
            Object.entries(input.mcp.harnesses ?? {}).map(([name, value]) => [
              name,
              { enabled: value.enabled ?? [], disabled: value.disabled ?? [] },
            ]),
          ),
        };
  const config: LoadedConfig = {
    version: 1,
    dialect: 1,
    ...(input.engine === undefined ? {} : { engine: input.engine }),
    ...(input.profile === undefined ? {} : { profile: input.profile }),
    ...(mcp &&
    (mcp.enabled.length > 0 || mcp.disabled.length > 0 || Object.keys(mcp.harnesses).length > 0)
      ? { mcp }
      : {}),
    harnesses,
    paths,
    sources: resolution.sources,
    skills: { ...entitySettings(input.skills), external: input.skills?.external ?? [] },
    agents: entitySettings(input.agents),
    rules: entitySettings(input.rules),
    assets: entitySettings(input.assets),
    shared: { agentsSkillsDir: input.shared?.agentsSkillsDir ?? "dedupe" },
    lint: {
      descriptionPrefix: {
        value: input.lint?.descriptionPrefix?.value ?? "Use when",
        severity: input.lint?.descriptionPrefix?.severity ?? "warn",
      },
      structure: { severity: input.lint?.structure?.severity ?? "off" },
      questions: {
        severity: input.lint?.questions?.severity ?? "error",
        allowProse: input.lint?.questions?.allowProse ?? [],
      },
      references: { severity: input.lint?.references?.severity ?? "error" },
    },
    generated: { commit: input.generated?.commit ?? false },
    hooks: {
      postInstall: (input.hooks?.postInstall ?? []).map((command) => ({ command })),
    },
  };
  return config;
}
