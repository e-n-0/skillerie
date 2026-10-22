import { lstat, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { expect, it } from "vitest";
import { lifecycleSuite, tree } from "./helpers.js";

const suite = lifecycleSuite();

it("installs all four harnesses when the sample enables them", async () => {
  // Given: isolated homes with all four sample adapters enabled.
  const { home, repo } = suite.sandbox;
  // When: the built CLI installs the sample.
  const result = await suite.run(["install", "--json"]);
  // Then: native key files exist and installed links use the stable current path.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: true,
    installations: [
      { harness: "opencode", installed: true, owner: { path: repo } },
      { harness: "codex", installed: true },
      { harness: "omo", installed: true },
      { harness: "pi", installed: true },
    ],
  });
  for (const path of [
    ".config/opencode/opencode.jsonc",
    ".omo/omo.jsonc",
    ".omo/content/mcp.json",
    ".pi/agent/mcp.json",
  ]) {
    expect((await lstat(join(home, path))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(home, path))).toMatch(
      new RegExp(`${repo}/generated/current/(opencode|omo|pi)/`),
    );
    expect((await readFile(join(home, path))).length).toBeGreaterThan(0);
  }
  const codex = await readFile(join(home, ".codex/config.toml"), "utf8");
  expect(parseToml(codex)["model"]).toBe("example-model");
  expect(codex).toContain("# skillerie:codex.settings.root:begin");
  expect(codex).toContain("# skillerie:codex.mcp.tables:begin");
}, 30_000);

it("reports clean ownership when installation is unchanged", async () => {
  // Given: a complete installation.
  expect((await suite.run(["install"])).code).toBe(0);
  const before = await tree(suite.sandbox.root);
  // When: status reads the current installation.
  const result = await suite.run(["status", "--json"]);
  // Then: ownership is clean and status has no side effects.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: true,
    clean: true,
    drift: [],
    installations: expect.arrayContaining([
      expect.objectContaining({
        harness: "codex",
        installed: true,
        actions: [],
        userEdits: [],
      }),
    ]),
  });
  expect(await tree(suite.sandbox.root)).toEqual(before);
}, 30_000);

it("makes no changes when install runs a second time", async () => {
  // Given: generated output and ownership from a successful install.
  expect((await suite.run(["install"])).code).toBe(0);
  const before = await tree(suite.sandbox.root);
  // When: the same command runs again.
  const result = await suite.run(["install", "--json"]);
  // Then: each harness has an empty plan and all bytes, links, and directories stay identical.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: true,
    installations: [{ actions: [] }, { actions: [] }, { actions: [] }, { actions: [] }],
  });
  expect(await tree(suite.sandbox.root)).toEqual(before);
}, 30_000);

it("restores the initial home when uninstall removes managed content", async () => {
  // Given: foreign TOML and unrelated user content before installation.
  const { home } = suite.sandbox;
  await mkdir(join(home, ".codex"));
  await writeFile(join(home, ".codex/config.toml"), '# User settings\n[custom]\nmode = "local"\n');
  await writeFile(join(home, "notes.txt"), "User notes\n");
  const before = await tree(home);
  expect((await suite.run(["install"])).code).toBe(0);
  // When: uninstall restores every harness's recorded preimages.
  const result = await suite.run(["uninstall", "--json"]);
  // Then: only external backup storage remains in addition to the original home.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(await tree(home)).toEqual(before);
  expect((await tree(suite.sandbox.backup)).length).toBeGreaterThan(1);
}, 30_000);

it("preserves other harness links when install selects one harness", async () => {
  // Given: all harnesses installed, followed by changed source instructions.
  const { home, repo } = suite.sandbox;
  expect((await suite.run(["install"])).code).toBe(0);
  const prior = await Promise.all(
    [".config/opencode/AGENTS.md", ".omo/content/AGENTS.md", ".pi/agent/AGENTS.md"].map(
      async (path) => ({ path, content: await readFile(join(home, path), "utf8") }),
    ),
  );
  const original = await readFile(join(repo, "instructions.md"), "utf8");
  await writeFile(join(repo, "instructions.md"), original + "\nAn additional instruction.\n");
  // When: installation selects only Codex.
  const result = await suite.run(["install", "--harness", "codex", "--json"]);
  // Then: the shared current generation still serves every installed harness.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: true,
    installations: [{ harness: "codex" }],
  });
  for (const file of prior)
    expect(await readFile(join(home, file.path), "utf8")).not.toBe(file.content);
}, 30_000);

it("uninstalls from ownership when source content has been removed", async () => {
  // Given: an installation whose authored skill tree is no longer available.
  const before = await tree(suite.sandbox.home);
  expect((await suite.run(["install"])).code).toBe(0);
  await rm(join(suite.sandbox.repo, "skills"), { recursive: true });
  // When: teardown uses the manifest rather than rerendering.
  const result = await suite.run(["uninstall", "--json"]);
  // Then: the empty initial home is restored without source-validation failures.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(await tree(suite.sandbox.home)).toEqual(before);
}, 30_000);

it("updates managed blocks when templates change without losing foreign settings", async () => {
  // Given: installed blocks and a user-owned table added afterward.
  const { home, repo } = suite.sandbox;
  expect((await suite.run(["install"])).code).toBe(0);
  const target = join(home, ".codex/config.toml");
  await writeFile(target, (await readFile(target, "utf8")) + '\n[user]\ntheme = "light"\n');
  await writeFile(join(repo, "harnesses/codex/templates/config.toml"), 'model = "revised-model"\n');
  // When: install rebuilds both managed blocks over the foreign content.
  const result = await suite.run(["install", "--json"]);
  // Then: new managed values coexist with the user's table and status remains clean.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(parseToml(await readFile(target, "utf8"))).toMatchObject({
    model: "revised-model",
    user: { theme: "light" },
  });
  expect((await suite.run(["status", "--json"])).code).toBe(0);
}, 30_000);
