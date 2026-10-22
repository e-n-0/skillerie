import { readFile, writeFile } from "node:fs/promises";
import { parse } from "smol-toml";
import { expect, it } from "vitest";
import { install, planInstall, uninstall } from "../../src/install/index.js";
import { backups, fixture, snapshot } from "./helpers.js";

const managed = 'model = "managed"\n[mcp_servers.docs]\nurl = "https://example.com"\n';
const cases = [
  {
    name: "an identical table",
    original: '[mcp_servers.docs]\nurl = "https://example.com"\n',
    paths: ["/mcp_servers/docs"],
  },
  {
    name: "a root key",
    original: 'model = "local"\n',
    paths: ["/model"],
  },
  {
    name: "foreign marker blocks",
    original:
      '# legacy:servers:begin\r\n[mcp_servers.docs]\r\nurl = "https://example.com/old"\r\n' +
      '[mcp_servers.tracker]\r\nurl = "https://example.com/tracker"\r\n# legacy:servers:end\r\n',
    paths: ["/mcp_servers/docs"],
  },
] as const;

it.each(cases)("plans collisions without changing bytes when encountering $name", async (entry) => {
  // Given: an unmanaged definition already occupies a managed name.
  const f = await fixture();
  await writeFile(f.target, entry.original);
  const options = {
    ...f.options,
    actions: [
      {
        kind: "mergeBlock" as const,
        format: "toml" as const,
        target: f.target,
        blockId: "settings",
        content: managed,
      },
    ],
  };
  const before = await snapshot(f.home);
  // When: a pure plan inspects the merge.
  const plan = await planInstall(options);
  // Then: each collision identifies the target and no filesystem entry changes.
  expect(plan.findings.map((finding) => [finding.code, finding.file, finding.jsonPath])).toEqual(
    entry.paths.map((path) => ["merge.conflict", f.target, path]),
  );
  expect(await snapshot(f.home)).toEqual(before);
});

it.each(cases)(
  "refuses installation before target mutations when encountering $name",
  async (entry) => {
    // Given: a conflict follows a separate install action in the same transaction.
    const f = await fixture();
    await writeFile(f.target, entry.original);
    const options = {
      ...f.options,
      actions: [
        { kind: "copy" as const, target: f.target + ".other", source: f.source },
        {
          kind: "mergeBlock" as const,
          format: "toml" as const,
          target: f.target,
          blockId: "settings",
          content: managed,
        },
      ],
    };
    // When: plain installation attempts the complete transaction.
    const result = install(options);
    // Then: it refuses with target-attributed collisions, leaving both targets untouched.
    await expect(result).rejects.toMatchObject({ code: "merge.conflict", file: f.target });
    expect(await readFile(f.target, "utf8")).toBe(entry.original);
    await expect(readFile(f.target + ".other")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(f.options.backupRoot)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each(cases)("backs up and restores original bytes after force takes $name", async (entry) => {
  // Given: an unmanaged conflict needs explicit ownership takeover.
  const f = await fixture();
  await writeFile(f.target, entry.original);
  const options = {
    ...f.options,
    force: true,
    actions: [
      {
        kind: "mergeBlock" as const,
        format: "toml" as const,
        target: f.target,
        blockId: "settings",
        content: managed,
      },
    ],
  };
  // When: force installs, reinstalls, and then uninstalls the managed block.
  const plan = await install(options);
  const installed = parse(await readFile(f.target, "utf8"));
  const saved = await backups(options);
  const rerun = await install(options);
  await uninstall({ ...options, force: false });
  // Then: backup and manifest retain the preimage, and removal restores even original line endings.
  expect(
    saved.filter((value) => value.startsWith("file:")).map((value) => value.split(":")[2]),
  ).toContain(Buffer.from(entry.original).toString("base64"));
  expect(installed).toMatchObject({
    model: "managed",
    mcp_servers: { docs: { url: "https://example.com" } },
  });
  if (entry.name === "foreign marker blocks")
    expect(installed).toMatchObject({
      mcp_servers: { tracker: { url: "https://example.com/tracker" } },
    });
  expect(plan.manifest.entries.find((item) => item.target === f.target)?.preimage).toMatchObject({
    kind: "file",
    data: Buffer.from(entry.original).toString("base64"),
  });
  expect(rerun.actions).toEqual([]);
  expect(await readFile(f.target, "utf8")).toBe(entry.original);
});

it("restores displaced definitions while preserving unrelated value edits", async () => {
  // Given: takeover displaces both a root value and a table.
  const f = await fixture();
  const original = 'model = "local"\nkeep = "original"\n[mcp_servers.docs]\nlocal = true\n';
  await writeFile(f.target, original);
  const options = {
    ...f.options,
    force: true,
    actions: [
      {
        kind: "mergeBlock" as const,
        format: "toml" as const,
        target: f.target,
        blockId: "settings",
        content: managed,
      },
    ],
  };
  await install(options);
  await writeFile(
    f.target,
    (await readFile(f.target, "utf8")).replace('keep = "original"', 'keep = "edited"'),
  );
  // When: normal uninstall removes intact managed markers.
  await uninstall({ ...options, force: false });
  // Then: displaced source returns, but the unrelated user's edit survives.
  expect(parse(await readFile(f.target, "utf8"))).toEqual({
    model: "local",
    keep: "edited",
    mcp_servers: { docs: { local: true } },
  });
});
