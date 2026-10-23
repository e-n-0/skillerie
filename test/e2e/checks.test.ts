import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { lifecycleSuite, tree } from "./helpers.js";

const suite = lifecycleSuite();

it("writes nothing when install check plans the first installation", async () => {
  // Given: absent harness homes, no generation, and a hook that would create a sentinel.
  const config = join(suite.sandbox.repo, "skillerie.yaml");
  await writeFile(
    config,
    (await readFile(config, "utf8")) + '\nhooks:\n  postInstall:\n    - "touch hook-ran"\n',
  );
  const before = await tree(suite.sandbox.root);
  // When: the real command performs a dry run.
  const result = await suite.run(["install", "--check", "--verbose"]);
  // Then: a nonempty readable plan is printed without any filesystem mutation.
  expect(result.code, result.stderr + result.stdout).toBe(1);
  expect(result.stdout).toMatch(/^ {6}LINK /m);
  expect(result.stdout).toMatch(/^ {6}MERGE /m);
  expect(result.stdout).toContain("Run skillerie install to apply these changes.");
  expect(await tree(suite.sandbox.root)).toEqual(before);
}, 30_000);

it("succeeds without writes when install check finds no drift", async () => {
  // Given: an installed sample and its complete filesystem snapshot.
  expect((await suite.run(["install"])).code).toBe(0);
  const before = await tree(suite.sandbox.root);
  // When: JSON check plans the same installation.
  const result = await suite.run(["install", "--check", "--json"]);
  // Then: no changes are needed and no state, cache, or backup is written.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ valid: true, drift: [] });
  expect(await tree(suite.sandbox.root)).toEqual(before);
}, 30_000);

it.each(["status", "install"] as const)(
  "reports generation drift when %s checks edited sources",
  async (command) => {
    // Given: a successful installation followed by new instruction bytes.
    expect((await suite.run(["install"])).code).toBe(0);
    const file = join(suite.sandbox.repo, "instructions.md");
    await writeFile(file, (await readFile(file, "utf8")) + "\nNew guidance.\n");
    const before = await tree(suite.sandbox.root);
    // When: a read-only lifecycle command compares expected output.
    const result = await suite.run([
      command,
      ...(command === "install" ? ["--check"] : []),
      "--json",
    ]);
    // Then: drift determines the process exit status and leaves every path intact.
    expect(result.code, result.stderr + result.stdout).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      valid: false,
      drift: expect.arrayContaining([{ relPath: "opencode/AGENTS.md", reason: "content" }]),
    });
    expect(await tree(suite.sandbox.root)).toEqual(before);
  },
  30_000,
);

it("reports the environment without writes when doctor uses JSON", async () => {
  // Given: an uninstalled sample using isolated environment paths.
  const before = await tree(suite.sandbox.root);
  // When: doctor checks the Node runtime and configured harness homes.
  const result = await suite.run(["doctor", "--json"]);
  // Then: the response contains real diagnostics and no state has been created.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: true,
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "doctor.node.supported" }),
      expect.objectContaining({ code: "doctor.home.writable" }),
    ]),
  });
  expect(await tree(suite.sandbox.root)).toEqual(before);
}, 30_000);

it("writes nothing when uninstall has no ownership manifest", async () => {
  // Given: no prior install and no metadata or harness directories.
  const before = await tree(suite.sandbox.root);
  // When: uninstall has no managed paths to release.
  const result = await suite.run(["uninstall", "--json"]);
  // Then: teardown is a pure no-op, including lock and directory creation.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ valid: true, installations: [] });
  expect(await tree(suite.sandbox.root)).toEqual(before);
}, 30_000);
