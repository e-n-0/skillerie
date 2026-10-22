import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { adapter } from "../../../src/adapters/pi/index.js";
import { syncRepo } from "../../../src/engine/index.js";
import { readTree } from "../../../src/model/files.js";
import type { Diagnostic } from "../../../src/core/types.js";
import { adapters, sampleRepo } from "../../engine/helpers.js";

const golden = fileURLToPath(new URL("../../golden/pi/", import.meta.url));
let sample: Awaited<ReturnType<typeof sampleRepo>>;
beforeEach(async () => {
  sample = await sampleRepo();
});
afterEach(async () => {
  await sample.cleanup();
});

it("matches golden output when the sample repository runs through the real engine", async () => {
  // Given: the shared sample fixture and only the Pi adapter injected.
  const options = {
    env: sample.env,
    os: "linux" as const,
    adapters: adapters(adapter),
    harness: "pi" as const,
  };
  // When: the full pipeline validates, expands, renders, and activates a generation.
  const result = await syncRepo(sample.repo, options);
  // Then: every generated file matches the reviewed portable golden tree.
  expect(result.diagnostics).toEqual([]);
  if (!result.generation) throw new TypeError("Expected an activated generation.");
  const diagnostics: Diagnostic[] = [];
  const output = await readTree(join(result.generation.dir, "pi"), diagnostics);
  const actual = output.map((file) => ({
    path: file.relPath,
    content: file.content.toString("utf8").replaceAll(sample.repo, "/home/alice/config"),
    mode: file.mode,
  }));
  if (process.env["UPDATE_GOLDEN"] === "1") {
    await rm(golden, { recursive: true, force: true });
    for (const file of actual) {
      const path = join(golden, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content, { mode: file.mode });
    }
  }
  const expected = (await readTree(golden, diagnostics)).map((file) => ({
    path: file.relPath,
    content: file.content.toString("utf8"),
    mode: file.mode,
  }));
  expect(diagnostics).toEqual([]);
  expect(actual).toEqual(expected);
});

it("detects generated drift when an installed generation has been edited", async () => {
  // Given: a genuine engine generation with changed rendered bytes.
  const options = { env: sample.env, adapters: adapters(adapter), harness: "pi" as const };
  const initial = await syncRepo(sample.repo, options);
  expect(initial.diagnostics).toEqual([]);
  await writeFile(join(sample.repo, "generated/current/pi/settings.json"), "{}\n");
  // When: the engine checks freshness using the same adapter.
  const result = await syncRepo(sample.repo, { ...options, check: true });
  // Then: the native configuration drift is detected.
  expect(result.drift).toContainEqual({ relPath: "pi/settings.json", reason: "content" });
});
