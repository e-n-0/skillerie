import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { Adapter, Diagnostic, Entity, HarnessPaths, ResolvedContext } from "../core/types.js";
import { HARNESS_IDS } from "../engine/types.js";
import { extractVersion, homeAccess, versionSatisfies } from "./probes.js";
import type { DoctorContext } from "./types.js";

function pathsFor(adapter: Adapter, context: DoctorContext): HarnessPaths {
  const defaults = adapter.defaultPaths(context.env);
  const configured = context.snapshot.config.harnesses[adapter.id];
  const home = configured?.path ?? defaults.home;
  const relocate = (path: string): string => resolve(home, relative(defaults.home, path));
  const agentDir = configured?.options["agentDir"];
  return {
    home,
    configDir: relocate(defaults.configDir),
    skillsDir: relocate(defaults.skillsDir),
    agentsDir:
      adapter.id === "omo" && typeof agentDir === "string"
        ? agentDir
        : relocate(defaults.agentsDir),
    rulesDir: relocate(defaults.rulesDir),
    assetsDir: relocate(defaults.assetsDir),
    ...(defaults.commandsDir ? { commandsDir: relocate(defaults.commandsDir) } : {}),
  };
}

function entitiesWithRequirements(model: DoctorContext["model"]): readonly Entity[] {
  const effective = Object.values(model.harnesses).flatMap((sources) =>
    sources ? [...sources.skills, ...sources.agents, ...sources.rules, ...sources.assets] : [],
  );
  return [...model.skills, ...model.agents, ...model.rules, ...model.assets, ...effective];
}

export async function checkRequiredBins(context: DoctorContext): Promise<readonly Diagnostic[]> {
  const bins = new Map<string, string>();
  for (const entity of entitiesWithRequirements(context.model)) {
    const required = entity.requires?.bin;
    const names = typeof required === "string" ? [required] : (required ?? []);
    for (const name of names) if (!bins.has(name)) bins.set(name, entity.file);
  }

  const diagnostics: Diagnostic[] = [];
  for (const [name, file] of bins) {
    const available = (await context.findExecutable(name)) !== undefined;
    diagnostics.push({
      severity: available ? "info" : "warn",
      code: available ? "doctor.bin.available" : "doctor.bin.missing",
      message: available
        ? `Required binary "${name}" is available.`
        : `Required binary "${name}" was not found.`,
      file,
      jsonPath: "/requires/bin",
    });
  }
  return diagnostics;
}

export async function checkHarnesses(context: DoctorContext): Promise<readonly Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const harness of HARNESS_IDS) {
    if (!context.snapshot.config.harnesses[harness]?.enabled) continue;
    const executable = await context.findExecutable(harness);
    const loader = context.adapters.get(harness);
    let installed: string | undefined;

    if (executable === undefined) {
      diagnostics.push({
        severity: "info",
        code: "doctor.harness.missing",
        message: `Harness CLI "${harness}" was not found on PATH.`,
        file: join(context.model.repoDir, "skillerie.yaml"),
        jsonPath: `/harnesses/${harness}`,
      });
    } else {
      installed = extractVersion((await context.probeVersion(executable)) ?? "");
      if (installed === undefined)
        diagnostics.push({
          severity: "warn",
          code: "doctor.harness.version",
          message: `Could not determine the version of "${harness}".`,
          file: executable,
          jsonPath: `/harnesses/${harness}`,
        });
    }

    if (loader === undefined) {
      diagnostics.push({
        severity: "error",
        code: "doctor.adapter.missing",
        message: `No adapter is registered for enabled harness "${harness}".`,
        file: join(context.model.repoDir, "skillerie.yaml"),
        jsonPath: `/harnesses/${harness}`,
      });
      continue;
    }

    const { adapter } = await loader();
    if (adapter.id !== harness) {
      diagnostics.push({
        severity: "error",
        code: "doctor.adapter.mismatch",
        message: `Registered adapter does not match harness "${harness}".`,
        file: join(context.model.repoDir, "skillerie.yaml"),
        jsonPath: `/harnesses/${harness}`,
      });
      continue;
    }

    if (installed !== undefined) {
      const supported = versionSatisfies(adapter.supportedRange, installed);
      diagnostics.push({
        severity: supported ? "info" : "warn",
        code: supported ? "doctor.harness.supported" : "doctor.harness.unsupported",
        message: `Harness "${harness}" version ${installed} ${supported ? "is within" : "is outside"} the supported range ${adapter.supportedRange}.`,
        file: executable ?? join(context.model.repoDir, "skillerie.yaml"),
        jsonPath: `/harnesses/${harness}`,
      });
    }

    const paths = pathsFor(adapter, context);
    for (const home of new Set([paths.home, paths.agentsDir])) {
      const access = await homeAccess(home);
      diagnostics.push({
        severity: access.writable ? "info" : "error",
        code: access.writable ? "doctor.home.writable" : "doctor.home.unwritable",
        message: access.writable
          ? `Harness home "${home}" is writable or can be created.`
          : `Harness home "${home}" cannot be written or created; check "${access.checkedPath}".`,
        file: home,
        jsonPath: `/harnesses/${harness}/path`,
      });
    }

    const runCheck = adapter.check && executable !== undefined;
    if (adapter.doctor || runCheck) {
      const adapterContext: ResolvedContext = {
        snapshot: context.snapshot,
        model: context.model,
        harness,
        paths,
        harnessVersion: {
          supportedRange: adapter.supportedRange,
          ...(installed === undefined ? {} : { installed }),
          ...(executable === undefined ? {} : { executable }),
        },
        env: context.env,
      };
      if (adapter.doctor) diagnostics.push(...(await adapter.doctor(adapterContext)));
      if (runCheck && adapter.check) diagnostics.push(...(await adapter.check(adapterContext)));
    }
  }
  return diagnostics;
}

export async function checkSharedSkills(context: DoctorContext): Promise<readonly Diagnostic[]> {
  const managedSkills = new Set(
    HARNESS_IDS.flatMap((harness) =>
      context.snapshot.config.harnesses[harness]?.enabled
        ? (context.model.harnesses[harness]?.skills.map((skill) => skill.name) ?? [])
        : [],
    ),
  );
  if (managedSkills.size === 0) return [];

  const sharedSkillsDir = join(context.env["HOME"] || homedir(), ".agents", "skills");
  const diagnostics: Diagnostic[] = [];
  try {
    const entries = await readdir(sharedSkillsDir, { withFileTypes: true });
    for (const entry of entries)
      if (managedSkills.has(entry.name))
        diagnostics.push({
          severity: "warn",
          code: "doctor.sharedSkill.shadow",
          message: `Shared skill "${entry.name}" shadows a managed skill.`,
          file: join(sharedSkillsDir, entry.name),
          jsonPath: "/shared/agentsSkillsDir",
        });
  } catch (error) {
    const code =
      error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;
    if (code === "ENOENT") return diagnostics;
    if (code !== "EACCES" && code !== "EPERM" && code !== "ENOTDIR") throw error;
    diagnostics.push({
      severity: "warn",
      code: "doctor.sharedSkill.unreadable",
      message: `Could not inspect shared skills at "${sharedSkillsDir}".`,
      file: sharedSkillsDir,
      jsonPath: "/shared/agentsSkillsDir",
    });
  }
  return diagnostics;
}
