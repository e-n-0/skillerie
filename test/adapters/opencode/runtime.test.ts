import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { adapter } from "../../../src/adapters/opencode/index.js";
import { check } from "../../../src/adapters/opencode/check.js";
import { sampleContext } from "./helpers.js";

let sample: Awaited<ReturnType<typeof sampleContext>>;
beforeEach(async () => {
  sample = await sampleContext();
});
afterEach(async () => {
  await sample.cleanup();
});

it("honors XDG config home when resolving default paths", () => {
  // Given: captured home variables.
  const env = { HOME: "/home/alice", XDG_CONFIG_HOME: "/home/alice/config" };
  // When: deriving runtime paths.
  const paths = adapter.defaultPaths(env);
  // Then: all owned directories share the configured OpenCode root.
  expect(paths).toEqual({
    home: "/home/alice/config/opencode",
    configDir: "/home/alice/config/opencode",
    skillsDir: "/home/alice/config/opencode/skills",
    agentsDir: "/home/alice/config/opencode/agents",
    commandsDir: "/home/alice/config/opencode/commands",
    rulesDir: "/home/alice/config/opencode/rules",
    assetsDir: "/home/alice/config/opencode",
  });
});

it("uses the home fallback when XDG config home is empty", () => {
  // Given: an empty optional XDG variable.
  const env = { HOME: "/home/alice", XDG_CONFIG_HOME: "" };
  // When: resolving paths.
  const paths = adapter.defaultPaths(env);
  // Then: the conventional configuration root is used.
  expect(paths.home).toBe("/home/alice/.config/opencode");
});

it("describes all installed namespaces when runtime assets are selected", () => {
  // Given: opt-in TUI settings and plugins.
  const ctx = sample.ctx;
  const sources = ctx.model.harnesses.opencode;
  if (!sources) throw new TypeError("The sample requires OpenCode sources.");
  const model = {
    ...ctx.model,
    harnesses: {
      ...ctx.model.harnesses,
      opencode: {
        ...sources,
        assets: [
          {
            name: "tui.json",
            file: "tui.json",
            sourcePath: "tui.json",
            relPath: "tui.json",
            kind: "file" as const,
            source: "user" as const,
            harnesses: ["opencode" as const],
          },
        ],
      },
    },
  };
  // When: requesting declarative install actions.
  const actions = adapter.targets({ ...ctx, model }, "/home/alice/cache/current");
  // Then: config uses links and each owned namespace is exclusive.
  expect(actions.filter((action) => action.kind === "link").map((action) => action.source)).toEqual(
    [
      "/home/alice/cache/current/opencode/AGENTS.md",
      "/home/alice/cache/current/opencode/opencode.jsonc",
      "/home/alice/cache/current/opencode/tui.json",
    ],
  );
  expect(
    actions
      .filter((action) => action.kind === "exclusiveTree")
      .map((action) => ({
        name: action.source.split("/").at(-1),
        target: action.target,
        preserve: action.preserve,
      })),
  ).toEqual(
    ["skills", "agents", "commands", "plugins", "rules"].map((name) => ({
      name,
      target: join(ctx.paths.home, name),
      preserve: [],
    })),
  );
});

it("passes selected assets through without translating plugin code", async () => {
  // Given: opt-in plugin code and TUI settings.
  const sources = sample.ctx.model.harnesses.opencode;
  if (!sources) throw new TypeError("The sample requires OpenCode sources.");
  const plugins = join(sample.root, "plugins");
  await mkdir(plugins);
  await writeFile(join(plugins, "docs.js"), 'export const name = "Read";\n');
  const tui = join(sample.root, "tui.json");
  await writeFile(tui, '{"theme":"system"}\n');
  const assets = [
    {
      name: "plugins",
      file: plugins,
      sourcePath: plugins,
      relPath: "plugins",
      kind: "directory" as const,
      source: "user" as const,
      harnesses: ["opencode" as const],
    },
    {
      name: "tui.json",
      file: tui,
      sourcePath: tui,
      relPath: "tui.json",
      kind: "file" as const,
      source: "user" as const,
      harnesses: ["opencode" as const],
    },
  ];
  // When: rendering the effective source inventory.
  const result = await adapter.render({
    ...sample.ctx,
    model: {
      ...sample.ctx.model,
      harnesses: { ...sample.ctx.model.harnesses, opencode: { ...sources, assets } },
    },
  });
  // Then: executable assets are copied byte-for-byte only from the selected list.
  expect(result.diagnostics).toEqual([]);
  expect(result.files.find((entry) => entry.relPath === "plugins/docs.js")?.content).toEqual(
    Buffer.from('export const name = "Read";\n'),
  );
  expect(result.files.find((entry) => entry.relPath === "tui.json")?.content).toEqual(
    Buffer.from('{"theme":"system"}\n'),
  );
});

it("skips native validation when the captured CLI is absent", async () => {
  // Given: an explicitly absent executable.
  const ctx = {
    ...sample.ctx,
    harnessVersion: {
      supportedRange: adapter.supportedRange,
      executable: join(sample.root, "absent"),
    },
  };
  // When: running headless validation.
  const result = await check(ctx);
  // Then: an informational diagnostic distinguishes absence from invalid configuration.
  expect(result).toEqual([
    expect.objectContaining({ severity: "info", code: "opencode.checkSkipped" }),
  ]);
});

it("uses native config validation when the executable accepts the resolved input", async () => {
  // Given: a process-level CLI fixture that validates invocation and input.
  const executable = join(sample.root, "opencode");
  await writeFile(
    executable,
    '#!/bin/sh\n[ "$1" = debug ] && [ "$2" = config ] && [ -n "$OPENCODE_CONFIG_CONTENT" ] && [ "$OPENCODE_DISABLE_MODELS_FETCH" = true ]\n',
  );
  await chmod(executable, 0o755);
  const ctx = {
    ...sample.ctx,
    harnessVersion: { supportedRange: adapter.supportedRange, executable },
  };
  // When: running the native validation path.
  const result = await check(ctx);
  // Then: a successful headless exit produces no finding.
  expect(result).toEqual([]);
});

it("reports native failure without leaking resolved output when validation exits nonzero", async () => {
  // Given: a process-level CLI fixture that rejects configuration.
  const executable = join(sample.root, "opencode");
  await writeFile(executable, '#!/bin/sh\nprintf "%s" "$OPENCODE_CONFIG_CONTENT" >&2\nexit 1\n');
  await chmod(executable, 0o755);
  // When: the native validator fails.
  const result = await check({
    ...sample.ctx,
    harnessVersion: { supportedRange: adapter.supportedRange, executable },
  });
  // Then: diagnostics identify failure without copying sensitive process output.
  expect(result).toEqual([expect.objectContaining({ severity: "error", code: "opencode.check" })]);
  expect(JSON.stringify(result)).not.toContain(sample.repo);
});
