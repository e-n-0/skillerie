import { join } from "node:path";
import { registry } from "../adapters/index.js";
import type { Diagnostic, RenderedFile } from "../core/types.js";
import { runDoctor } from "../doctor/index.js";
import { swapCurrent, writeGeneration } from "../fs/index.js";
import { InstallError } from "../install/index.js";
import type { InstallOptions, InstallPlan, Manifest } from "../install/index.js";
import { readManifest } from "../install/storage.js";
import { postInstallHooks } from "./hooks.js";
import { installationResult, installOptions } from "./installation.js";
import { generationDrift, installRendered, previewInstall } from "./install-preview.js";
import type { InstallationResult, LifecycleOptions, LifecycleResult } from "./lifecycle-types.js";
import { contextFor, renderHarness } from "./render.js";
import { HARNESS_IDS, hasErrors } from "./types.js";
import { uninstallRepo } from "./uninstall-repo.js";
import { validateRepo } from "./validation.js";

export type * from "./lifecycle-types.js";

interface PreparedInstallation {
  readonly options: InstallOptions;
  readonly plan: InstallPlan;
  readonly manifest: Manifest | undefined;
}

async function manageRepo(repoDir: string, options: LifecycleOptions): Promise<LifecycleResult> {
  const env = { ...(options.env ?? process.env) };
  const validated = await validateRepo(repoDir, { ...options, env });
  const diagnostics = [...validated.diagnostics];
  const { snapshot, model } = validated;
  const installations: InstallationResult[] = [];
  if (!snapshot || !model || hasErrors(diagnostics))
    return { valid: false, diagnostics, installations };
  if (options.command === "doctor") {
    diagnostics.push(
      ...(await runDoctor({
        snapshot,
        model,
        env,
        ...(options.adapters ? { adapters: options.adapters } : {}),
      })),
    );
    return { valid: !hasErrors(diagnostics), diagnostics, installations };
  }
  if (options.harness && !snapshot.config.harnesses[options.harness]?.enabled) {
    diagnostics.push({
      severity: "error",
      code: "engine.harness",
      message: `Harness ${options.harness} is not enabled.`,
    });
    return { valid: false, diagnostics, installations };
  }
  const root = join(snapshot.config.paths.cache, "current");
  const files: RenderedFile[] = [];
  const selected: InstallOptions[] = [];
  for (const harness of HARNESS_IDS) {
    if (!snapshot.config.harnesses[harness]?.enabled) continue;
    const load = (options.adapters ?? registry).get(harness);
    if (!load) {
      diagnostics.push({
        severity: "error",
        code: "engine.adapter",
        message: `No adapter is registered for enabled harness ${harness}.`,
      });
      continue;
    }
    const { adapter } = await load();
    if (adapter.id !== harness)
      throw new InstallError("engine.adapter", `Adapter does not match harness ${harness}.`);
    const input = { model, snapshot, env };
    const rendered = await renderHarness(adapter, input);
    files.push(...rendered.files);
    diagnostics.push(...rendered.diagnostics);
    if (!options.harness || harness === options.harness)
      selected.push(
        installOptions({
          config: snapshot.config,
          harness,
          actions: adapter.targets(contextFor(adapter, input), root),
          engineVersion: snapshot.engineVersion,
          options,
        }),
      );
  }
  if (hasErrors(diagnostics)) return { valid: false, diagnostics, installations };
  const prepared: PreparedInstallation[] = [];
  for (const install of selected) {
    const manifest = await readManifest(install.harnessHome);
    try {
      const plan = await previewInstall(install, { root, files });
      diagnostics.push(...plan.findings);
      prepared.push({ options: install, plan, manifest });
      installations.push(installationResult({ options: install, plan, manifest }));
    } catch (error) {
      if (!(error instanceof InstallError)) throw error;
      diagnostics.push({
        severity: "error",
        code: error.code,
        message: error.message,
        file: error.file ?? install.harnessHome,
      });
      installations.push({
        harness: install.harness,
        home: install.harnessHome,
        installed: manifest !== undefined,
        ...(manifest ? { owner: manifest.repo } : {}),
        managedPaths: manifest?.entries.map((entry) => entry.target) ?? [],
        actions: [],
        userEdits: [],
      });
    }
  }
  if (hasErrors(diagnostics)) return { valid: false, diagnostics, installations };
  const userEdits = installations.some((item) => item.userEdits.length > 0);
  if (options.command === "status") {
    const drift = await generationDrift({ root, files });
    const clean =
      !userEdits &&
      drift.length === 0 &&
      prepared.every((item) => item.manifest && item.plan.actions.length === 0);
    return { valid: clean, clean, drift, diagnostics, installations };
  }
  if (options.check) {
    const drift = await generationDrift({ root, files });
    return {
      valid:
        !userEdits &&
        drift.length === 0 &&
        prepared.every((item) => item.plan.actions.length === 0),
      drift,
      diagnostics,
      installations,
    };
  }
  // Publish every enabled harness, even for a selected install, so existing links stay live.
  const generation = await writeGeneration(snapshot.config.paths.cache, snapshot, files);
  await swapCurrent(snapshot.config.paths.cache, generation);
  const installed: InstallationResult[] = [];
  for (const item of prepared) {
    const plan = await installRendered(item.options, { root, files });
    diagnostics.push(
      ...plan.findings.filter(
        (finding) =>
          !diagnostics.some((prior) => JSON.stringify(prior) === JSON.stringify(finding)),
      ),
    );
    installed.push(installationResult({ options: item.options, plan, manifest: plan.manifest }));
  }
  if (!installed.some((item) => item.userEdits.length))
    diagnostics.push(
      ...(await postInstallHooks({
        config: snapshot.config,
        harnesses: selected.map((item) => item.harness),
        env,
      })),
    );
  return {
    valid: !hasErrors(diagnostics) && !installed.some((item) => item.userEdits.length),
    diagnostics,
    installations: installed,
  };
}

export async function runLifecycle(
  repoDir: string,
  options: LifecycleOptions,
): Promise<LifecycleResult> {
  try {
    switch (options.command) {
      case "install":
      case "status":
      case "doctor":
        return await manageRepo(repoDir, options);
      case "uninstall":
        return await uninstallRepo(repoDir, options);
      default:
        return assertNever(options.command);
    }
  } catch (error) {
    if (!(error instanceof InstallError)) throw error;
    const diagnostic: Diagnostic = {
      severity: "error",
      code: error.code,
      message: error.message,
      ...(error.file ? { file: error.file } : {}),
    };
    return { valid: false, diagnostics: [diagnostic], installations: [] };
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected lifecycle command: ${JSON.stringify(value)}`);
}
