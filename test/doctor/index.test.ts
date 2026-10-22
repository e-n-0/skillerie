import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Adapter, Diagnostic, InputSnapshot, SourceModel } from "../../src/core/types.js";
import { validateRepo } from "../../src/engine/index.js";
import { runDoctor } from "../../src/doctor/index.js";
import type { DoctorOptions } from "../../src/doctor/index.js";
import { HARNESS_IDS } from "../../src/engine/types.js";
import { fakeAdapter, sampleRepo } from "../engine/helpers.js";

let sample: Awaited<ReturnType<typeof sampleRepo>>;
let snapshot: InputSnapshot;
let model: SourceModel;

beforeEach(async () => {
  sample = await sampleRepo();
  const validated = await validateRepo(sample.repo, { env: sample.env });
  if (!validated.snapshot || !validated.model)
    throw new Error("sample repository did not validate");
  snapshot = validated.snapshot;
  model = validated.model;
});

afterEach(async () => {
  await sample.cleanup();
});

function adapterRegistry(root: string, doctor?: Adapter["doctor"], check?: Adapter["check"]) {
  return new Map(
    HARNESS_IDS.map((id) => {
      const home = join(root, id);
      const adapter: Adapter = {
        ...fakeAdapter(id),
        defaultPaths: () => ({
          home,
          configDir: home,
          skillsDir: join(home, "skills"),
          agentsDir: join(home, "agents"),
          rulesDir: join(home, "rules"),
          assetsDir: join(home, "assets"),
        }),
        ...(doctor ? { doctor } : {}),
        ...(check ? { check } : {}),
      };
      return [id, async () => ({ adapter })] as const;
    }),
  );
}

function doctorOptions(
  findExecutable: DoctorOptions["findExecutable"] = async (name) => `/virtual/${name}`,
  probeVersion: DoctorOptions["probeVersion"] = async () => "v1.2.3",
): DoctorOptions {
  return {
    snapshot,
    model,
    env: sample.env,
    adapters: adapterRegistry(sample.root),
    findExecutable,
    probeVersion,
  };
}

it("compares the running Node and installed harness versions", async () => {
  // Given: a Node release below the package requirement and harness releases below adapter ranges.
  const options = doctorOptions(
    async (name) => `/virtual/${name}`,
    async () => "v0.9.0",
  );
  // When: environment diagnostics run.
  const diagnostics = await runDoctor({ ...options, nodeVersion: "20.0.0" });
  // Then: both compatibility boundaries are reported.
  expect(diagnostics).toContainEqual(expect.objectContaining({ code: "doctor.node.unsupported" }));
  expect(diagnostics.filter((item) => item.code === "doctor.harness.unsupported")).toHaveLength(
    HARNESS_IDS.length,
  );
});

it("accepts prerelease harness versions when they satisfy the supported range", async () => {
  // Given: Pi reports a dated prerelease newer than its supported minimum.
  const adapter = { ...fakeAdapter("pi"), supportedRange: ">=0.85.0" };
  const options = doctorOptions(
    async (name) => (name === "pi" ? "/virtual/pi" : undefined),
    async () => "2026.10.19-2",
  );
  // When: doctor compares the installed harness against its adapter range.
  const diagnostics = await runDoctor({
    ...options,
    adapters: new Map([...adapterRegistry(sample.root), ["pi", async () => ({ adapter })]]),
  });
  // Then: the prerelease is supported, not warned about.
  expect(
    diagnostics.filter(
      (item) => item.code.startsWith("doctor.harness.") && item.file === "/virtual/pi",
    ),
  ).toEqual([expect.objectContaining({ code: "doctor.harness.supported", severity: "info" })]);
});

it("reports an absent harness CLI and an available required binary", async () => {
  // Given: the harness CLI is absent while declared binaries resolve through the injected lookup.
  const diagnosticsPromise = runDoctor(
    doctorOptions(async (name) => (name === "opencode" ? undefined : `/virtual/${name}`)),
  );
  // When: environment diagnostics run.
  const diagnostics = await diagnosticsPromise;
  // Then: absence is informational and available requirements are visible.
  expect(diagnostics).toContainEqual(
    expect.objectContaining({ code: "doctor.harness.missing", severity: "info" }),
  );
  expect(diagnostics).toContainEqual(
    expect.objectContaining({ code: "doctor.bin.available", severity: "info" }),
  );
});

it("warns when a declared required binary cannot be found", async () => {
  // Given: the required runtime binary cannot be resolved.
  const findExecutable = async (name: string) => (name === "node" ? undefined : `/virtual/${name}`);
  // When: environment diagnostics run.
  const diagnostics = await runDoctor(doctorOptions(findExecutable));
  // Then: the missing requirement is a warning tied to its source.
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      code: "doctor.bin.missing",
      severity: "warn",
      file: join(sample.repo, "rules/runtime.md"),
    }),
  );
});

it("does not discover harness CLIs from the working directory when PATH is unset", async () => {
  // Given: an executable in the repository but no captured PATH.
  const executable = join(sample.repo, "opencode");
  await writeFile(executable, "not run");
  await chmod(executable, 0o755);
  // When: doctor uses its default PATH lookup.
  const diagnostics = await runDoctor({
    snapshot,
    model,
    env: { HOME: sample.env["HOME"] },
    adapters: adapterRegistry(sample.root),
    probeVersion: async () => "v1.2.3",
  });
  // Then: the working-directory executable is not treated as a PATH match.
  expect(diagnostics).toContainEqual(
    expect.objectContaining({ code: "doctor.harness.missing", severity: "info" }),
  );
});

it("reports an unwritable configured home without creating it", async () => {
  // Given: the configured harness home would be beneath a regular file.
  const blocker = join(sample.root, "occupied");
  await writeFile(blocker, "file");
  const configured = snapshot.config.harnesses.opencode;
  if (!configured) throw new Error("sample OpenCode configuration is missing");
  const adjustedSnapshot: InputSnapshot = {
    ...snapshot,
    config: {
      ...snapshot.config,
      harnesses: {
        ...snapshot.config.harnesses,
        opencode: { ...configured, path: join(blocker, "home") },
      },
    },
  };
  // When: environment diagnostics run against that configured path.
  const diagnostics = await runDoctor({ ...doctorOptions(), snapshot: adjustedSnapshot });
  // Then: the invalid home is reported and remains absent.
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      code: "doctor.home.unwritable",
      severity: "error",
      file: join(blocker, "home"),
    }),
  );
  await expect(stat(join(blocker, "home"))).rejects.toMatchObject({
    code: "ENOTDIR",
  });
});

it("warns when a shared skill shadows a managed skill", async () => {
  // Given: a shared skill entry uses a name managed for an enabled harness.
  const skill = model.harnesses.opencode?.skills[0];
  if (!skill) throw new Error("sample repository has no OpenCode skill");
  const sharedSkills = join(sample.env["HOME"] ?? sample.root, ".agents", "skills");
  await mkdir(sharedSkills, { recursive: true });
  await writeFile(join(sharedSkills, skill.name), "shared content");
  // When: environment diagnostics run.
  const diagnostics = await runDoctor(doctorOptions());
  // Then: the collision is a warning at the shadowing entry.
  expect(diagnostics).toContainEqual(
    expect.objectContaining({
      code: "doctor.sharedSkill.shadow",
      severity: "warn",
      file: join(sharedSkills, skill.name),
    }),
  );
});

it("includes diagnostics from enabled adapter doctor hooks", async () => {
  // Given: enabled adapters provide read-only doctor findings.
  const hook: NonNullable<Adapter["doctor"]> = async (context) => [
    {
      severity: "info",
      code: `adapter.${context.harness}.doctor`,
      message: "Adapter-specific check completed.",
    } satisfies Diagnostic,
  ];
  const options = doctorOptions();
  const adapters = adapterRegistry(sample.root, hook);
  // When: environment diagnostics run with those adapters.
  const diagnostics = await runDoctor({ ...options, adapters });
  // Then: each enabled adapter finding is included.
  expect(diagnostics.filter((item) => item.code.endsWith(".doctor"))).toHaveLength(
    HARNESS_IDS.length,
  );
});

it("runs adapter config checks only for harnesses whose CLI is installed", async () => {
  // Given: adapters with a headless config check, and only the codex CLI on PATH.
  const check: NonNullable<Adapter["check"]> = async (context) => [
    {
      severity: "info",
      code: `adapter.${context.harness}.check`,
      message: `Checked with ${context.harnessVersion.executable ?? "nothing"}.`,
    } satisfies Diagnostic,
  ];
  const options = doctorOptions(async (name) => (name === "codex" ? "/virtual/codex" : undefined));
  const adapters = adapterRegistry(sample.root, undefined, check);
  // When: environment diagnostics run.
  const diagnostics = await runDoctor({ ...options, adapters });
  // Then: only the installed harness is checked, using the probed executable.
  const checks = diagnostics.filter((item) => item.code.endsWith(".check"));
  expect(checks).toEqual([
    expect.objectContaining({
      code: "adapter.codex.check",
      message: "Checked with /virtual/codex.",
    }),
  ]);
});
