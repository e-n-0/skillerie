import { join, resolve } from "node:path";
import type { Adapter } from "../core/types.js";
import { registry } from "../adapters/index.js";
import { loadConfig } from "../config/index.js";
import { lintModel } from "../lint/index.js";
import { buildSnapshot, discoverSources } from "../model/index.js";
import { ENGINE_VERSION } from "../version.js";
import { checkEngineVersion } from "./compatibility.js";
import { expandSources } from "./expansion.js";
import { lintJsonSources } from "./json-sources.js";
import { lintInstructionReferences } from "./references.js";
import { resolveRequirements } from "./requirements.js";
import { restrictionDiagnostics } from "./render.js";
import { HARNESS_IDS, hasErrors } from "./types.js";
import type { EngineOptions, ValidationResult } from "./types.js";
import { resolveExternalSkills } from "./external/cache.js";
import { externalDiagnostics } from "./diagnostics.js";

export async function validateRepo(
  repoDir: string,
  options: EngineOptions = {},
): Promise<ValidationResult> {
  const env = { ...(options.env ?? process.env) };
  options.onProgress?.("Loading configuration");
  const loaded = await loadConfig(repoDir, env, {
    ...(options.profile === undefined ? {} : { profile: options.profile }),
  });
  const diagnostics = [...loaded.diagnostics];
  const config = loaded.config;
  if (!config || hasErrors(diagnostics)) return { diagnostics };
  const profile = config.profile === undefined ? {} : { profile: config.profile };
  const engineVersion = options.engineVersion ?? ENGINE_VERSION;
  diagnostics.push(
    ...checkEngineVersion(config.engine, engineVersion, resolve(repoDir, "skillerie.yaml")),
  );
  if (hasErrors(diagnostics)) return { ...profile, diagnostics };
  if (config.skills.external?.length) options.onProgress?.("Resolving external skills");
  const external = await resolveExternalSkills(config, env, {
    ...(options.offlineExternal === undefined ? {} : { offline: options.offlineExternal }),
  });
  const diagnosticSources = external.entries.map((entry) => ({
    directory: join(entry.directory, entry.revision.path),
    revision: entry.revision,
  }));
  diagnostics.push(...external.diagnostics);
  if (hasErrors(diagnostics))
    return { ...profile, diagnostics: externalDiagnostics(diagnostics, diagnosticSources) };
  options.onProgress?.("Reading sources");
  const discovered = await discoverSources(repoDir, config, external.entries);
  diagnostics.push(...discovered.diagnostics);
  const source = discovered.model;
  if (!source || hasErrors(diagnostics))
    return { ...profile, diagnostics: externalDiagnostics(diagnostics, diagnosticSources) };
  diagnostics.push(...lintModel(source, config));
  diagnostics.push(...(await lintJsonSources(source)));
  const expanded = expandSources(source, {
    repo: config.paths.repo,
    home: config.paths.home,
    paths: config.paths,
  });
  diagnostics.push(...expanded.diagnostics);
  if (hasErrors(diagnostics))
    return { ...profile, diagnostics: externalDiagnostics(diagnostics, diagnosticSources) };
  const os = options.os ?? process.platform;
  if (os !== "darwin" && os !== "linux") {
    diagnostics.push({
      severity: "error",
      code: "engine.platform",
      message: `Unsupported operating system: ${os}.`,
      file: resolve(repoDir, "skillerie.yaml"),
      jsonPath: "",
    });
    return { ...profile, diagnostics: externalDiagnostics(diagnostics, diagnosticSources) };
  }
  options.onProgress?.("Checking requirements");
  const evaluated = await resolveRequirements(expanded.model, { env, os });
  const prior = new Set(diagnostics.map((item) => JSON.stringify(item)));
  diagnostics.push(
    ...[
      ...lintModel(evaluated.model, config),
      ...lintInstructionReferences(evaluated.model, config),
    ].filter((item) => !prior.has(JSON.stringify(item))),
  );
  const adapters: Adapter[] = [];
  for (const harness of HARNESS_IDS) {
    if (!config.harnesses[harness]?.enabled) continue;
    const load = (options.adapters ?? registry).get(harness);
    if (!load) continue;
    const { adapter } = await load();
    adapters.push(adapter);
  }
  diagnostics.push(...restrictionDiagnostics(adapters, evaluated.model));
  if (hasErrors(diagnostics))
    return { ...profile, diagnostics: externalDiagnostics(diagnostics, diagnosticSources) };
  // Snapshot the discovered inventory, whose captured bytes predate filtering/expansion.
  const snapshot = await buildSnapshot(config, source, evaluated.requires, engineVersion);
  return {
    ...profile,
    diagnostics: externalDiagnostics(diagnostics, diagnosticSources),
    model: evaluated.model,
    snapshot,
  };
}
