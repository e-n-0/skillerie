import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { registry } from "../adapters/index.js";
import type { Diagnostic, RenderedFile } from "../core/types.js";
import { diffTree, readGeneration, swapCurrent, writeGeneration } from "../fs/index.js";
import type { TreeDifference } from "../fs/index.js";
import { renderHarness } from "./render.js";
import { selectSnapshot } from "./selection.js";
import { HARNESS_IDS, hasErrors } from "./types.js";
import type { SyncOptions, SyncResult } from "./types.js";
import { validateRepo } from "./validation.js";
import { externalStateFiles } from "./external/state.js";

async function currentExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function syncRepo(repoDir: string, options: SyncOptions = {}): Promise<SyncResult> {
  const env = { ...(options.env ?? process.env) };
  const validated = await validateRepo(repoDir, { ...options, env });
  const { model, snapshot } = validated;
  const diagnostics: Diagnostic[] = [...validated.diagnostics];
  const profile = validated.profile === undefined ? {} : { profile: validated.profile };
  if (!model || !snapshot || hasErrors(diagnostics)) return { ...profile, diagnostics, drift: [] };
  if (options.harness && snapshot.config.harnesses[options.harness]?.enabled !== true) {
    diagnostics.push({
      severity: "error",
      code: "engine.harness",
      message: `Harness ${options.harness} is not enabled.`,
      file: resolve(repoDir, "skillerie.yaml"),
      jsonPath: `/harnesses/${options.harness}`,
    });
    return { ...profile, diagnostics, drift: [] };
  }
  const selected = HARNESS_IDS.filter(
    (id) => snapshot.config.harnesses[id]?.enabled && (!options.harness || id === options.harness),
  );
  const adapters = options.adapters ?? registry;
  const effectiveSnapshot = options.harness ? selectSnapshot(snapshot, options.harness) : snapshot;
  const files: RenderedFile[] = [...externalStateFiles(effectiveSnapshot)];
  for (const harness of selected) {
    const load = adapters.get(harness);
    if (!load) continue;
    const { adapter } = await load();
    if (adapter.id !== harness) {
      diagnostics.push({
        severity: "error",
        code: "engine.adapter",
        message: `Registered adapter does not match harness ${harness}.`,
        file: resolve(repoDir, "skillerie.yaml"),
        jsonPath: `/harnesses/${harness}`,
      });
      continue;
    }
    options.onProgress?.(`Rendering ${harness}`);
    const result = await renderHarness(adapter, { model, snapshot: effectiveSnapshot, env });
    files.push(...result.files);
    diagnostics.push(...result.diagnostics);
  }
  if (hasErrors(diagnostics)) return { ...profile, diagnostics, drift: [] };
  const cache = snapshot.config.paths.cache;
  const current = join(cache, "current");
  if (!options.check) {
    const generation = await writeGeneration(cache, effectiveSnapshot, files);
    await swapCurrent(cache, generation);
    return { ...validated, diagnostics, snapshot: effectiveSnapshot, generation, drift: [] };
  }
  const temporary = await mkdtemp(join(tmpdir(), "skillerie-check-"));
  try {
    const generation = await writeGeneration(temporary, effectiveSnapshot, files);
    const expected = await readGeneration(generation.dir);
    const exists = await currentExists(current);
    const differences: readonly TreeDifference[] = exists
      ? await diffTree(expected, current)
      : expected.map((file) => ({ relPath: file.relPath, reason: "missing" }));
    const drift = options.harness
      ? differences.filter((item) => item.relPath.startsWith(`${options.harness}/`))
      : differences;
    diagnostics.push(
      ...drift.map((difference) => ({
        severity: "error" as const,
        code: "sync.drift",
        message: `Generated output differs (${difference.reason}).`,
        file: join(current, difference.relPath),
        line: 1,
      })),
    );
    return { ...validated, diagnostics, snapshot: effectiveSnapshot, drift };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
