import { cp, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { lifecycleSuite, tree } from "./helpers.js";

const suite = lifecycleSuite();

it("backs up foreign symlinks when install replaces an owned path", async () => {
  // Given: a dangling foreign configuration link.
  const target = join(suite.sandbox.home, ".config/opencode/opencode.jsonc");
  const foreign = join(suite.sandbox.home, "missing.jsonc");
  await mkdir(join(suite.sandbox.home, ".config/opencode"), { recursive: true });
  await symlink(foreign, target);
  const before = await tree(suite.sandbox.home);
  // When: installation replaces the foreign link.
  const result = await suite.run(["install", "--json"]);
  // Then: the link is backed up rather than deleted, and teardown can restore it.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect((await tree(suite.sandbox.backup)).some((entry) => entry.endsWith(foreign))).toBe(true);
  expect((await suite.run(["uninstall"])).code).toBe(0);
  expect(await tree(suite.sandbox.home)).toEqual(before);
}, 30_000);

it("rejects competing repositories when ownership is not transferred", async () => {
  // Given: another repository with equivalent source content.
  expect((await suite.run(["install"])).code).toBe(0);
  const other = join(suite.sandbox.root, "other-repo");
  await cp(suite.sandbox.repo, other, { recursive: true });
  const before = await tree(suite.sandbox.root);
  // When: the second repository attempts to install into the same homes.
  const result = await suite.run(["install", "--json"], other);
  // Then: ownership is rejected before generation activation or installation mutation.
  expect(result.code, result.stderr + result.stdout).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: false,
    diagnostics: expect.arrayContaining([expect.objectContaining({ code: "install.owner" })]),
    installations: expect.arrayContaining([
      expect.objectContaining({ owner: expect.objectContaining({ path: suite.sandbox.repo }) }),
    ]),
  });
  expect(await tree(suite.sandbox.root)).toEqual(before);
}, 30_000);

it("transfers ownership when install explicitly takes over", async () => {
  // Given: a different repository owns the configured homes.
  expect((await suite.run(["install"])).code).toBe(0);
  const other = join(suite.sandbox.root, "other-repo");
  await cp(suite.sandbox.repo, other, { recursive: true });
  // When: the new repository takes over.
  const result = await suite.run(["install", "--takeover", "--json"], other);
  // Then: installed links and persisted ownership identify the new source repository.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: true,
    installations: expect.arrayContaining([
      expect.objectContaining({ owner: expect.objectContaining({ path: other }) }),
    ]),
  });
  expect(await readlink(join(suite.sandbox.home, ".pi/agent/mcp.json"))).toBe(
    join(other, "generated/current/pi/mcp.json"),
  );
  expect((await suite.run(["status", "--json"], other)).code).toBe(0);
}, 30_000);

it("preserves user edits when install is not forced", async () => {
  // Given: a user replaces a managed link with a personal file.
  expect((await suite.run(["install"])).code).toBe(0);
  const target = join(suite.sandbox.home, ".config/opencode/opencode.jsonc");
  await rm(target);
  await writeFile(target, '{"theme":"personal"}\n');
  // When: installation tries to reconcile the edited path.
  const result = await suite.run(["install", "--json"]);
  // Then: the edit remains in place and appears in status and install diagnostics.
  expect(result.code, result.stderr + result.stdout).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: false,
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "install.user-edit", file: target }),
    ]),
  });
  expect(await readFile(target, "utf8")).toBe('{"theme":"personal"}\n');
  const status = await suite.run(["status", "--json"]);
  expect(status.code).toBe(1);
  expect(JSON.parse(status.stdout)).toMatchObject({
    clean: false,
    installations: expect.arrayContaining([expect.objectContaining({ userEdits: [target] })]),
  });
}, 30_000);

it("backs up edits when install is forced", async () => {
  // Given: a managed path replaced by user bytes.
  expect((await suite.run(["install"])).code).toBe(0);
  const target = join(suite.sandbox.home, ".config/opencode/opencode.jsonc");
  await rm(target);
  const edited = '{"theme":"personal"}\n';
  await writeFile(target, edited);
  // When: force explicitly allows replacement.
  const result = await suite.run(["install", "--force", "--json"]);
  // Then: the generated link is restored and the edit survives in backup storage.
  expect(result.code, result.stderr + result.stdout).toBe(0);
  expect(await readlink(target)).toBe(
    join(suite.sandbox.repo, "generated/current/opencode/opencode.jsonc"),
  );
  expect(
    (await tree(suite.sandbox.backup)).some((entry) =>
      entry.endsWith(Buffer.from(edited).toString("base64")),
    ),
  ).toBe(true);
}, 30_000);
