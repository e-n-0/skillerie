import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, isAbsolute, resolve } from "node:path";
import type {
  Entity,
  EntityRequiresResult,
  Environment,
  HarnessId,
  HarnessSources,
  SourceModel,
} from "../core/types.js";
import { evaluateRequires } from "../model/index.js";

/** Probe only declared binaries; never invoke commands or inspect their output. */
async function availableBins(model: SourceModel, env: Environment): Promise<ReadonlySet<string>> {
  const names = new Set(
    Object.values(model.harnesses).flatMap((sources) =>
      [...sources.skills, ...sources.agents, ...sources.rules, ...sources.assets].flatMap(
        (entity) => {
          const bins = entity.requires?.bin;
          return typeof bins === "string" ? [bins] : (bins ?? []);
        },
      ),
    ),
  );
  const available = new Set<string>();
  for (const name of names) {
    const candidates =
      isAbsolute(name) || name.includes("/")
        ? [resolve(model.repoDir, name)]
        : (env["PATH"] ?? "").split(delimiter).map((dir) => resolve(dir || ".", name));
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK);
        if (!(await stat(candidate)).isFile()) continue;
        available.add(name);
        break;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          !["ENOENT", "EACCES", "ENOTDIR"].includes(String(error.code))
        )
          throw error;
      }
    }
  }
  return available;
}

interface RequirementInput {
  readonly env: Environment;
  readonly os: "darwin" | "linux";
}

/** Preserve the complete inventory, filtering only effective harness sources. */
export async function resolveRequirements(model: SourceModel, input: RequirementInput) {
  const binaries = await availableBins(model, input.env);
  const requires: EntityRequiresResult[] = [];
  const harnesses: Partial<Record<HarnessId, HarnessSources>> = {};
  for (const harness of ["opencode", "codex", "omo", "pi"] as const) {
    const sources = model.harnesses[harness];
    if (!sources) continue;
    const select = <T extends Entity>(
      entities: readonly T[],
      entityKind: EntityRequiresResult["entityKind"],
    ): readonly T[] =>
      entities.filter((entity) => {
        const override =
          input.env[`SKILLERIE_FORCE_${entity.name.toUpperCase().replaceAll("-", "_")}`];
        const result = evaluateRequires(entity.requires, {
          ...input,
          harness,
          availableBins: binaries,
          ...(override === "0" || override === "1" ? { force: override === "1" } : {}),
        });
        requires.push({ entityKind, name: entity.name, harness, result });
        return result.satisfied;
      });
    harnesses[harness] = {
      skills: select(sources.skills, "skill"),
      agents: select(sources.agents, "agent"),
      rules: select(sources.rules, "rule"),
      assets: select(sources.assets, "asset"),
    };
  }
  return { model: { ...model, harnesses }, requires };
}
