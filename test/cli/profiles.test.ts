import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { readManifest } from "../../src/install/storage.js";
import { sampleRepo } from "../engine/helpers.js";

let sample: Awaited<ReturnType<typeof sampleRepo>>;
beforeEach(async () => {
  sample = await sampleRepo();
});
afterEach(async () => {
  await sample.cleanup();
});

const commands = [
  { name: "validate", args: [] },
  { name: "sync", args: ["--check"] },
  { name: "install", args: ["--check"] },
  { name: "uninstall", args: [] },
  { name: "status", args: [] },
  { name: "doctor", args: [] },
] as const;

async function command(argv: readonly string[]) {
  const output: string[] = [];
  const errors: string[] = [];
  const code = await runCli(argv, {
    env: sample.env,
    stdout: (text) => {
      output.push(text);
    },
    stderr: (text) => {
      errors.push(text);
    },
  });
  return { code, stdout: output.join(""), stderr: errors.join("") };
}

async function writeProfiles() {
  await writeFile(
    join(sample.repo, "skillerie.yaml"),
    `version: 1
harnesses:
  opencode:
    enabled: true
    path: "\${home}/opencode"
paths:
  docs: "\${repo}/docs"
generated:
  commit: true
profiles:
  work: {}
  personal: {}
`,
  );
}

it.each(commands)("reports the first profile when $name uses JSON", async ({ name, args }) => {
  // Given: work precedes personal in a profiled configuration.
  await writeProfiles();
  // When: the command loads its default profile.
  const result = await command([name, ...args, "--repo", sample.repo, "--json"]);
  // Then: structured output identifies the applied profile without text output.
  expect(JSON.parse(result.stdout)).toHaveProperty("profile", "work");
  expect(result.stderr).toBe("");
});

it.each(commands)(
  "reports the selected profile when $name receives --profile",
  async ({ name, args }) => {
    // Given: personal is not the default profile.
    await writeProfiles();
    // When: the command explicitly selects personal.
    const result = await command([
      name,
      ...args,
      "--repo",
      sample.repo,
      "--profile",
      "personal",
      "--json",
    ]);
    // Then: the engine result carries that selection through the CLI.
    expect(JSON.parse(result.stdout)).toHaveProperty("profile", "personal");
    expect(result.stderr).toBe("");
  },
);

it.each(commands)("omits the profile field when $name has no profiles", async ({ name, args }) => {
  // Given: the sample configuration has no profiles.
  const argv = [name, ...args, "--repo", sample.repo, "--json"];
  // When: the command emits JSON.
  const result = await command(argv);
  // Then: existing consumers see no additional optional field.
  expect(JSON.parse(result.stdout)).not.toHaveProperty("profile");
});

it.each(["install", "status", "sync"] as const)(
  "prints the profile first when %s uses text output",
  async (name) => {
    // Given: a default work profile and a command with normal stdout.
    await writeProfiles();
    const args = name === "status" ? [] : ["--check"];
    // When: the command prints its plan or comparison.
    const result = await command([name, ...args, "--repo", sample.repo]);
    // Then: the profile precedes every other stdout line.
    expect(result.stdout.split("\n")[0]).toBe(name === "sync" ? "PROFILE work" : "Profile: work");
  },
);

it.each(["install", "status", "sync"] as const)(
  "omits the profile line when %s has no profiles",
  async (name) => {
    // Given: the original configuration without profiles.
    const args = name === "status" ? [] : ["--check"];
    // When: the command uses text output.
    const result = await command([name, ...args, "--repo", sample.repo]);
    // Then: no profile marker is added.
    expect(result.stdout).not.toMatch(/^PROFILE /m);
  },
);

it.each(["validate", "sync", "outdated", "install", "uninstall", "status", "doctor"] as const)(
  "rejects an unknown profile when %s loads configuration",
  async (name) => {
    // Given: a configuration defines work and personal, but not missing.
    await writeProfiles();
    // When: a command requests the unknown name.
    const result = await command([name, "--repo", sample.repo, "--profile", "missing"]);
    // Then: config diagnostics, rather than argument parsing, determine the exit status.
    expect(result.code).toBe(name === "outdated" ? 2 : 1);
    expect(result.stderr).toContain("config.profile.unknown");
  },
);

it("rejects a requested profile when the configuration has none", async () => {
  // Given: the original sample has no profiles.
  const args = ["validate", "--repo", sample.repo, "--profile", "personal", "--json"];
  // When: validation requests a named profile.
  const result = await command(args);
  // Then: selection fails with the configuration error contract.
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: false,
    diagnostics: [expect.objectContaining({ code: "config.profile.unknown" })],
  });
});

it("persists the selected profile when install writes its manifest", async () => {
  // Given: personal is a non-default profile.
  await writeProfiles();
  const home = join(sample.root, "home/opencode");
  // When: the real CLI installs personal.
  const result = await command([
    "install",
    "--repo",
    sample.repo,
    "--profile",
    "personal",
    "--json",
  ]);
  // Then: both the stored manifest and its boundary parser retain the applied name.
  expect(result.code, result.stdout + result.stderr).toBe(0);
  expect(JSON.parse(await readFile(join(home, ".skillerie/manifest.json"), "utf8"))).toHaveProperty(
    "profile",
    "personal",
  );
  expect(await readManifest(home)).toHaveProperty("profile", "personal");
});

it.each([
  { profile: undefined, mismatch: true },
  { profile: "personal", mismatch: false },
] as const)(
  "compares the installed profile when status selects $profile",
  async ({ profile, mismatch }) => {
    // Given: the harness was installed using personal.
    await writeProfiles();
    const installed = await command([
      "install",
      "--repo",
      sample.repo,
      "--profile",
      "personal",
      "--json",
    ]);
    expect(installed.code, installed.stdout + installed.stderr).toBe(0);
    // When: status compares the default or the same explicit profile.
    const result = await command([
      "status",
      "--repo",
      sample.repo,
      ...(profile === undefined ? [] : ["--profile", profile]),
      "--json",
    ]);
    // Then: only a different profile produces a located mismatch warning.
    const expected = expect.objectContaining({
      severity: "warn",
      code: "install.profile.mismatch",
      file: join(sample.root, "home/opencode"),
    });
    const parsed: unknown = JSON.parse(result.stdout);
    if (mismatch) expect(parsed).toMatchObject({ diagnostics: expect.arrayContaining([expected]) });
    else expect(parsed).toMatchObject({ diagnostics: expect.not.arrayContaining([expected]) });
  },
);

it.each([
  { name: "sync", args: ["--check", "--harness", "pi"] },
  { name: "install", args: ["--check", "--harness", "pi"] },
] as const)(
  "keeps the profile when $name fails after loading configuration",
  async ({ name, args }) => {
    // Given: a profiled configuration that does not enable pi.
    await writeProfiles();
    // When: the command fails on the disabled harness.
    const result = await command([
      name,
      ...args,
      "--repo",
      sample.repo,
      "--profile",
      "personal",
      "--json",
    ]);
    // Then: the failure still names the applied profile.
    const output = JSON.parse(result.stdout) as {
      profile?: string;
      diagnostics: { code: string }[];
    };
    expect(result.code).toBe(1);
    expect(output.diagnostics.map((item) => item.code)).toContain("engine.harness");
    expect(output.profile).toBe("personal");
  },
);

it.each(["install", "status", "uninstall"] as const)(
  "keeps the profile when %s hits an unreadable manifest",
  async (name) => {
    // Given: a profiled configuration whose harness home holds an unsupported manifest.
    await writeProfiles();
    const state = join(String(sample.env["HOME"]), "opencode", ".skillerie");
    await mkdir(state, { recursive: true });
    await writeFile(join(state, "manifest.json"), JSON.stringify({ version: 99 }));
    // When: the lifecycle command reads that manifest.
    const result = await command([name, "--repo", sample.repo, "--profile", "personal", "--json"]);
    // Then: the installer error still names the applied profile.
    const output = JSON.parse(result.stdout) as {
      profile?: string;
      diagnostics: { code: string }[];
    };
    expect(result.code).toBe(1);
    expect(output.diagnostics.map((item) => item.code)).toContain("state.invalid");
    expect(output.profile).toBe("personal");
  },
);
