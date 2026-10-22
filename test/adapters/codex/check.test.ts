import { chmod, copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { ResolvedContext } from "../../../src/core/types.js";
import { check } from "../../../src/adapters/codex/check.js";
import { context } from "./helpers.js";

let ctx: ResolvedContext;
let root: string;
let executable: string;
beforeEach(async () => {
  ctx = await context();
  root = await mkdtemp(join(tmpdir(), "skillerie-codex-test-"));
  executable = join(root, "codex.mjs");
  await copyFile(fileURLToPath(new URL("./fixtures/doctor.mjs", import.meta.url)), executable);
  await chmod(executable, 0o755);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it.each(["success", "nonzero"])("reports valid config when doctor mode is %s", async (mode) => {
  // Given: a real subprocess exercising the invocation contract and config parsing.
  const capture = join(root, "capture.json");
  const input = {
    ...ctx,
    env: {
      ...ctx.env,
      CHECK_CAPTURE: capture,
      CHECK_MODE: mode,
      CHECK_TOML_MODULE: import.meta.resolve("smol-toml"),
    },
    harnessVersion: { supportedRange: ctx.harnessVersion.supportedRange, executable },
  };
  // When: headless validation runs.
  const result = await check(input);
  // Then: config.load controls the result, and temporary state is cleaned up.
  expect(result).toEqual([expect.objectContaining({ severity: "info", code: "codex.doctor" })]);
  const data: unknown = JSON.parse(await readFile(capture, "utf8"));
  if (
    data === null ||
    typeof data !== "object" ||
    !("home" in data) ||
    typeof data.home !== "string"
  )
    throw new TypeError("Missing doctor capture");
  expect(data.home).not.toBe(ctx.paths.home);
  await expect(stat(data.home)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["failure", "malformed"])(
  "reports a validation error when doctor mode is %s",
  async (mode) => {
    // Given: a CLI whose output violates the config.load contract.
    const input = {
      ...ctx,
      env: {
        ...ctx.env,
        CHECK_CAPTURE: join(root, "capture.json"),
        CHECK_MODE: mode,
        CHECK_TOML_MODULE: import.meta.resolve("smol-toml"),
      },
      harnessVersion: { supportedRange: ctx.harnessVersion.supportedRange, executable },
    };
    // When: headless validation runs.
    const result = await check(input);
    // Then: invalid output cannot report success.
    expect(result).toEqual([expect.objectContaining({ severity: "error", code: "codex.doctor" })]);
  },
);

it("skips with an info diagnostic when the CLI is absent", async () => {
  // Given: an explicitly missing executable.
  const input = {
    ...ctx,
    harnessVersion: {
      supportedRange: ctx.harnessVersion.supportedRange,
      executable: join(root, "absent"),
    },
  };
  // When: headless validation probes it.
  const result = await check(input);
  // Then: absence is distinguishable from invalid configuration.
  expect(result).toEqual([
    expect.objectContaining({ severity: "info", code: "codex.checkSkipped" }),
  ]);
});
