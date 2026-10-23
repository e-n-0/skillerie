import { loadConfig } from "../config/index.js";
import { uninstall } from "../install/index.js";
import { readManifest } from "../install/storage.js";
import { ENGINE_VERSION } from "../version.js";
import { installationResult, installOptions } from "./installation.js";
import type { InstallationResult, LifecycleOptions, LifecycleResult } from "./lifecycle-types.js";
import { HARNESS_IDS, hasErrors } from "./types.js";

/** Teardown reads ownership metadata, not rendered sources that may have been removed. */
export async function uninstallRepo(
  repoDir: string,
  options: LifecycleOptions,
): Promise<LifecycleResult> {
  const loaded = await loadConfig(repoDir, options.env ?? process.env, {
    ...(options.profile === undefined ? {} : { profile: options.profile }),
  });
  const config = loaded.config;
  const diagnostics = [...loaded.diagnostics];
  const installations: InstallationResult[] = [];
  if (!config || hasErrors(diagnostics)) return { valid: false, diagnostics, installations };
  const profile = config.profile === undefined ? {} : { profile: config.profile };
  if (options.harness && !config.harnesses[options.harness]) {
    diagnostics.push({
      severity: "error",
      code: "engine.harness",
      message: `Harness ${options.harness} is not configured.`,
    });
    return { ...profile, valid: false, diagnostics, installations };
  }
  for (const harness of HARNESS_IDS) {
    const configured = config.harnesses[harness];
    if (!configured || (options.harness && options.harness !== harness)) continue;
    const manifest = await readManifest(configured.path);
    // An absent manifest must not cause even a lock directory to be created.
    if (!manifest) continue;
    options.onProgress?.(`Uninstalling ${harness}`);
    const install = installOptions({
      config,
      harness,
      actions: [],
      engineVersion: options.engineVersion ?? ENGINE_VERSION,
      options,
    });
    const plan = await uninstall(install);
    diagnostics.push(...plan.findings);
    installations.push(
      installationResult({
        options: install,
        plan,
        manifest: plan.manifest.entries.length ? plan.manifest : undefined,
      }),
    );
  }
  return {
    ...profile,
    valid: !hasErrors(diagnostics) && !installations.some((item) => item.userEdits.length),
    diagnostics,
    installations,
  };
}
