import { readFile, writeFile } from "node:fs/promises";
import { parse as parseToml } from "smol-toml";
import { expect, it } from "vitest";
import { install, uninstall } from "../../src/install/index.js";
import { fixture } from "./helpers.js";

it("merges TOML root settings before unrelated tables and restores exact preimages", async () => {
  // Given: a foreign TOML file has root settings and unrelated tables.
  const f = await fixture(),
    original = 'theme = "dark"\n\n[unrelated]\nkeep = true\n';
  await writeFile(f.target, original);
  const options = {
    ...f.options,
    actions: [
      {
        kind: "mergeBlock" as const,
        format: "toml" as const,
        target: f.target,
        blockId: "settings",
        content: 'approval = "ask"\n[managed]\nenabled = true\n',
      },
      {
        kind: "mergeBlock" as const,
        format: "toml" as const,
        target: f.target,
        blockId: "servers",
        content: '[servers.docs]\nurl = "https://example.com"\n',
      },
    ],
  };
  // When: blocks are installed twice and then removed.
  await install(options);
  const content = await readFile(f.target, "utf8");
  const rerun = await install(options);
  await uninstall(options);
  // Then: the root setting is actually at the root, no unrelated table changed, and bytes restore.
  expect(parseToml(content)).toMatchObject({
    theme: "dark",
    approval: "ask",
    unrelated: { keep: true },
    managed: { enabled: true },
  });
  expect(rerun.actions).toEqual([]);
  expect(await readFile(f.target, "utf8")).toBe(original);
});

it("appends unique JSON values and removes only the values it added", async () => {
  // Given: a settings array already has one requested value.
  const f = await fixture();
  await writeFile(f.target, JSON.stringify({ skills: ["existing", "shared"], theme: "dark" }));
  const options = {
    ...f.options,
    actions: [
      {
        kind: "jsonArrayMerge" as const,
        target: f.target,
        jsonPath: "/skills",
        blockId: "filters",
        values: ["shared", "managed", "managed"],
      },
    ],
  };
  await install(options);
  const installed: unknown = JSON.parse(await readFile(f.target, "utf8"));
  expect(installed).toEqual({ skills: ["existing", "shared", "managed"], theme: "dark" });
  await writeFile(
    f.target,
    JSON.stringify({ skills: ["existing", "shared", "managed", "user-added"], theme: "light" }),
  );
  // When: ownership is removed after unrelated user changes.
  await uninstall(options);
  // Then: user entries and unrelated settings survive.
  const restored: unknown = JSON.parse(await readFile(f.target, "utf8"));
  expect(restored).toEqual({ skills: ["existing", "shared", "user-added"], theme: "light" });
});

it("does not claim preexisting array values on an idempotent reinstall", async () => {
  // Given: one requested filter predates installation.
  const f = await fixture(),
    original = '{"skills":["shared"]}\n';
  await writeFile(f.target, original);
  const options = {
    ...f.options,
    actions: [
      {
        kind: "jsonArrayMerge" as const,
        target: f.target,
        jsonPath: "/skills",
        blockId: "filters",
        values: ["shared", "managed"],
      },
    ],
  };
  await install(options);
  // When: the same merge is reinstalled and removed.
  expect((await install(options)).actions).toEqual([]);
  await uninstall(options);
  // Then: the exact original document is retained.
  expect(await readFile(f.target, "utf8")).toBe(original);
});
