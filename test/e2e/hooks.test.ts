import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { lifecycleSuite, tree } from "./helpers.js";

const suite = lifecycleSuite();

it("passes install context when a post-install hook runs", async () => {
  // Given: a hook recording only the two documented context variables.
  const { repo } = suite.sandbox;
  const config = join(repo, "skillerie.yaml");
  const script =
    'require("node:fs").writeFileSync("hook.json", JSON.stringify({' +
    "repo: process.env.SKILLERIE_REPO, harnesses: process.env.SKILLERIE_HARNESSES}))";
  const command = `${JSON.stringify(process.execPath)} -e '${script}'`;
  await writeFile(
    config,
    (await readFile(config, "utf8")) +
      `\nhooks:\n  postInstall:\n    - ${JSON.stringify(command)}\n`,
  );
  // When: a selected harness installs successfully.
  const result = await suite.run(["install", "--harness", "codex", "--json"]);
  // Then: the hook ran from the source repository with only the installed harness selected.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(JSON.parse(await readFile(join(repo, "hook.json"), "utf8"))).toEqual({
    repo,
    harnesses: "codex",
  });
}, 30_000);

it("reports a warning when a post-install hook fails", async () => {
  // Given: a failing hook, including a legacy fatal setting.
  const config = join(suite.sandbox.repo, "skillerie.yaml");
  await writeFile(
    config,
    (await readFile(config, "utf8")) +
      '\nhooks:\n  postInstall:\n    - command: "exit 7"\n      fatal: true\n',
  );
  // When: installation completes but the hook exits nonzero.
  const result = await suite.run(["install", "--json"]);
  // Then: hook failure remains structured and does not fail the installed result.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: true,
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "install.hook", severity: "warn" }),
    ]),
  });
  expect(result.stderr).toBe("");
  expect((await suite.run(["status", "--json"])).code).toBe(0);
}, 30_000);

it("leaves seeds user-owned when uninstall runs", async () => {
  // Given: an initial seed copied by the OMO adapter.
  const seeds = join(suite.sandbox.repo, "harnesses/omo/seeds");
  await mkdir(seeds, { recursive: true });
  await writeFile(join(seeds, "session.json"), '{"initialized":true}\n');
  expect((await suite.run(["install"])).code).toBe(0);
  const target = join(suite.sandbox.home, ".omo/content/session.json");
  await writeFile(target, '{"initialized":false}\n');
  const before = await tree(suite.sandbox.root);
  // When: dry-run planning observes the seed, then uninstall removes managed files.
  const check = await suite.run(["install", "--check", "--json"]);
  // Then: the seed is neither reseeded nor removed from the user's home.
  expect(check.code, check.stderr + check.stdout).toBe(0);
  expect(await tree(suite.sandbox.root)).toEqual(before);
  expect((await suite.run(["uninstall"])).code).toBe(0);
  expect(await readFile(target, "utf8")).toBe('{"initialized":false}\n');
}, 30_000);
