import { mkdir, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { expect, it } from "vitest";
import { install, planInstall, uninstall } from "../../src/install/index.js";
import { fixture, snapshot } from "./helpers.js";

it("merges JSON object blocks and restores the original JSON bytes", async () => {
  // Given: a JSON file contains unrelated settings.
  const f = await fixture(),
    original = '{"theme":"dark"}\n';
  await writeFile(f.target, original);
  const options = {
    ...f.options,
    actions: [
      {
        kind: "mergeBlock" as const,
        format: "json" as const,
        target: f.target,
        blockId: "settings",
        content: '{"managed":true}',
      },
    ],
  };
  // When: a JSON block is installed twice and uninstalled.
  await install(options);
  const result: unknown = parse(await readFile(f.target, "utf8"));
  const rerun = await install(options);
  await uninstall(options);
  // Then: properties are merged once and the preimage restores exactly.
  expect(result).toEqual({ theme: "dark", managed: true });
  expect(rerun.actions).toEqual([]);
  expect(await readFile(f.target, "utf8")).toBe(original);
});

it("removes omitted managed entries through the pure install plan", async () => {
  // Given: a repository previously installed a link.
  const f = await fixture();
  await install(f.options);
  const before = await snapshot(f.home);
  // When: the new action set no longer includes it.
  const planned = await planInstall({ ...f.options, actions: [] });
  expect(await snapshot(f.home)).toEqual(before);
  await install({ ...f.options, actions: [] });
  // Then: the plan described its removal and reconciliation removed it.
  expect(planned.actions).toEqual(
    expect.arrayContaining([expect.objectContaining({ target: f.target, kind: "remove" })]),
  );
  expect((await snapshot(f.home))[".harness/config"]).toBeUndefined();
});

it("removes omitted managed blocks without removing unrelated blocks", async () => {
  // Given: two TOML blocks have been installed over a foreign root setting.
  const f = await fixture();
  await writeFile(f.target, 'theme = "dark"\n');
  const first = {
    kind: "mergeBlock" as const,
    format: "toml" as const,
    target: f.target,
    blockId: "first",
    content: "[first]\nvalue = true",
  };
  const second = { ...first, blockId: "second", content: "[second]\nvalue = true" };
  await install({ ...f.options, actions: [first, second] });
  // When: the second block is omitted from the next action set.
  await install({ ...f.options, actions: [first] });
  // Then: only the selected table remains, with the foreign setting.
  const content = await readFile(f.target, "utf8");
  expect(content).not.toContain("[second]");
  expect(content).toContain("[first]");
  expect(content).toContain('theme = "dark"');
});

it("rejects redirected destination parents without touching foreign files", async () => {
  // Given: a harness subdirectory points to a foreign directory.
  const f = await fixture(),
    foreign = join(f.root, "foreign");
  await mkdir(foreign);
  await writeFile(join(foreign, "config"), "foreign");
  await symlink(foreign, join(f.harnessHome, "redirected"));
  const before = await snapshot(f.root);
  // When: planning would write through the redirected parent.
  await expect(
    planInstall({
      ...f.options,
      actions: [
        { kind: "link", source: f.source, target: join(f.harnessHome, "redirected", "config") },
      ],
    }),
  ).rejects.toMatchObject({ code: "path.parent" });
  // Then: both the foreign file and the complete directory snapshot are unchanged.
  expect(await snapshot(f.root)).toEqual(before);
});

it("preserves invalid user JSON and allows explicit force recovery", async () => {
  // Given: a managed array file is replaced with invalid JSON.
  const f = await fixture();
  await writeFile(f.target, '{"skills":["original"]}');
  const options = {
    ...f.options,
    actions: [
      {
        kind: "jsonArrayMerge" as const,
        target: f.target,
        blockId: "filters",
        jsonPath: "/skills",
        values: ["managed"],
      },
    ],
  };
  await install(options);
  await writeFile(f.target, "{ invalid");
  // When: installation first preserves drift and then is forced.
  const normal = await install(options);
  await install({ ...options, force: true });
  // Then: malformed edits were reported, and explicit recovery produced valid settings.
  expect(normal.findings.some((finding) => finding.code === "install.user-edit")).toBe(true);
  const recovered: unknown = JSON.parse(await readFile(f.target, "utf8"));
  expect(recovered).toEqual({ skills: ["original", "managed"] });
});

it("keeps installed links pointed at the stable generation path", async () => {
  // Given: a stable pointer selects a generation directory.
  const f = await fixture(),
    current = join(f.root, "current");
  await symlink(join(f.root, "generation"), current);
  const source = join(current, "config");
  // When: a link action uses the stable path.
  await install({ ...f.options, actions: [{ kind: "link", source, target: f.target }] });
  // Then: installation does not resolve it to an ephemeral generation.
  expect(await readlink(f.target)).toBe(source);
});
