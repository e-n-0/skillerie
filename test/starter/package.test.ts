import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Environment } from "../../src/core/types.js";
import { syncRepo, validateRepo } from "../../src/engine/index.js";
import { HARNESS_IDS } from "../../src/engine/types.js";
import { lintModel } from "../../src/lint/index.js";
import { parseFrontmatter } from "../../src/model/index.js";

const starterSkills = fileURLToPath(new URL("../../starter/skills/", import.meta.url));
let root: string;
let repo: string;
let env: Environment;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skillerie-starter-"));
  repo = join(root, "repo");
  await mkdir(repo);
  env = { HOME: join(root, "home"), PATH: "" };
  await writeFile(
    join(repo, "skillerie.yaml"),
    [
      "version: 1",
      "starter: true",
      "generated:",
      "  commit: true",
      "harnesses:",
      ...HARNESS_IDS.map((harness) => `  ${harness}: { enabled: true }`),
      "",
    ].join("\n"),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it.each(HARNESS_IDS)("validates bundled starter content when %s is enabled", async (harness) => {
  // Given: a temporary repository enabling the installed starter for one harness.
  await writeFile(
    join(repo, "skillerie.yaml"),
    `version: 1\nstarter: true\nharnesses:\n  ${harness}: { enabled: true }\n`,
  );
  const names = (await readdir(starterSkills)).sort();
  // When: the engine resolves its own bundled content without a starterDir override.
  const result = await validateRepo(repo, { env });
  // Then: the complete starter inventory passes semantic lint for this harness.
  expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  if (!result.model || !result.snapshot) throw new Error("Expected a validated starter model.");
  expect(result.model.harnesses[harness]?.skills.map((skill) => skill.name).sort()).toEqual(names);
  expect(result.model.skills.every((skill) => skill.source === "starter")).toBe(true);
  expect(lintModel(result.model, result.snapshot.config)).toEqual([]);
});

it("renders starter skills when all four harnesses are synchronized", async () => {
  // Given: a repository with no user skills and every harness enabled.
  const names = (await readdir(starterSkills)).sort();
  // When: the real engine renders and activates all adapters.
  const result = await syncRepo(repo, { env });
  // Then: every bundled skill reaches every harness with its machine-readable identity.
  expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  expect(result.generation).toBeDefined();
  for (const harness of HARNESS_IDS) {
    const directory = join(repo, "generated/current", harness, "skills");
    expect((await readdir(directory)).sort()).toEqual(names);
    for (const name of names) {
      const file = join(directory, name, "SKILL.md");
      const parsed = parseFrontmatter(await readFile(file, "utf8"), file);
      expect(parsed.diagnostics).toEqual([]);
      expect(parsed.frontmatter?.["name"]).toBe(name);
    }
  }
}, 30_000);

it("ignores the starter directory when starter is disabled", async () => {
  // Given: opt-out configuration and a starter directory that does not exist.
  await writeFile(
    join(repo, "skillerie.yaml"),
    "version: 1\nstarter: false\nharnesses:\n  opencode: { enabled: true }\n",
  );
  // When: validation runs with a deliberately unavailable starter.
  const result = await validateRepo(repo, { env, starterDir: join(root, "missing") });
  // Then: no starter sources or source-read failures enter the model.
  expect(result.diagnostics).toEqual([]);
  expect(result.model?.skills).toEqual([]);
  expect(result.model?.agents).toEqual([]);
  expect(result.model?.rules).toEqual([]);
});

it("uses the supplied starter directory when an explicit override is provided", async () => {
  // Given: an alternate starter with one neutral skill.
  const starterDir = join(root, "alternate");
  const directory = join(starterDir, "skills", "example");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    [
      "---",
      "name: example",
      "description: Use when testing a local example.",
      'argument-hint: "[example]"',
      "user-invocable: true",
      "---",
      "# Example",
      "",
    ].join("\n"),
  );
  // When: validation receives an explicit directory override.
  const result = await validateRepo(repo, { env, starterDir });
  // Then: it uses only the overridden inventory, not the bundled fallback.
  expect(result.diagnostics).toEqual([]);
  expect(result.model?.skills.map((skill) => skill.name)).toEqual(["example"]);
});
