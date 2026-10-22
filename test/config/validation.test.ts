import { join } from "node:path";
import { rm } from "node:fs/promises";
import { expect, it } from "vitest";
import { loadConfig } from "../../src/config/index.js";
import { configRepo, env } from "./fixture.js";

it("reports a duplicate key when a YAML mapping repeats a property", async () => {
  // Given: a repeated key whose value would otherwise be valid.
  const repo = await configRepo("version: 1\nversion: 1\n");

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: the duplicate is rejected at its source line.
  expect(result.config).toBeUndefined();
  expect(result).toMatchObject({
    diagnostics: [
      {
        code: "config.duplicateKey",
        file: join(repo, "skillerie.yaml"),
        line: 2,
      },
    ],
  });
});

it("reports a schema pointer when a nested setting has the wrong type", async () => {
  // Given: a string where the schema requires a boolean.
  const repo = await configRepo("version: 1\nharnesses:\n  pi:\n    enabled: yes\n");

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: the invalid setting is identified by pointer and line.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "config.schema",
      jsonPath: "/harnesses/pi/enabled",
      file: join(repo, "skillerie.yaml"),
      line: 4,
    }),
  );
  expect(result.config).toBeUndefined();
});

it.each(["../outside", "/home/alice/skills"])(
  "rejects source path %s with its configuration pointer",
  async (sourcePath) => {
    // Given: a source path that escapes the repository or is absolute.
    const repo = await configRepo(`version: 1\nsources:\n  skills: ${sourcePath}\n`);

    // When: configuration is loaded.
    const result = await loadConfig(repo, env);

    // Then: validation points to the source path field.
    expect(result.config).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "config.sourcePath",
        jsonPath: "/sources/skills",
        file: join(repo, "skillerie.yaml"),
        line: 3,
      }),
    );
  },
);

it.each(["version", "dialect"])(
  "rejects an unsupported %s with an upgrade diagnostic",
  async (key) => {
    // Given: a document written for an unknown config or dialect version.
    const repo = await configRepo(key === "version" ? "version: 2\n" : "version: 1\ndialect: 2\n");

    // When: configuration is loaded.
    const result = await loadConfig(repo, env);

    // Then: no config is returned and the incompatible version is identified.
    expect(result.config).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "config.unsupportedVersion",
        jsonPath: `/${key}`,
        line: key === "version" ? 1 : 2,
        message: expect.stringMatching(/upgrade/i),
      }),
    );
  },
);

it("retains yes and no as strings when YAML 1.2 values are loaded", async () => {
  // Given: values YAML 1.1 would have interpreted as booleans.
  const repo = await configRepo(
    "version: 1\nharnesses:\n  pi:\n    options:\n      yes: yes\n      no: no\n",
  );

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: core-schema string semantics are preserved.
  expect(result.config?.harnesses.pi?.options).toEqual({
    yes: "yes",
    no: "no",
  });
});

it.each([
  ["version: 1\nsurprise: true\n", "/surprise", 2],
  ["version: 1\nskills:\n  surprise: true\n", "/skills/surprise", 3],
  ["version: 1\nharnesses:\n  other: {}\n", "/harnesses/other", 3],
  [
    "version: 1\nskills:\n  overrides:\n    debug:\n      surprise: true\n",
    "/skills/overrides/debug/surprise",
    5,
  ],
  [
    "version: 1\nskills:\n  overrides:\n    debug:\n      requires:\n        surprise: true\n",
    "/skills/overrides/debug/requires/surprise",
    6,
  ],
] as const)("rejects an unknown key at %s", async (source, jsonPath, line) => {
  // Given: an unknown key in a closed schema shape.
  const repo = await configRepo(source);

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: the extra property's source is included in the diagnostic.
  expect(result.config).toBeUndefined();
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ jsonPath, line }));
});

it("escapes JSON pointer segments when override names contain separators", async () => {
  // Given: a mapping key containing both RFC 6901 escape characters.
  const repo = await configRepo(
    "version: 1\nagents:\n  overrides:\n    'docs/~reader':\n      maxTurns: bad\n",
  );

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: the diagnostic path remains a valid unambiguous JSON pointer.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      jsonPath: "/agents/overrides/docs~1~0reader/maxTurns",
      line: 5,
    }),
  );
});

it("reports the missing version when the required property is absent", async () => {
  // Given: an otherwise valid empty mapping.
  const repo = await configRepo("{}\n");

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: schema validation reports the absent property at the root line.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      jsonPath: "/version",
      line: 1,
    }),
  );
});

it("returns a read diagnostic when the configuration file is missing", async () => {
  // Given: a repository without its configuration document.
  const repo = await configRepo("version: 1\n");
  await rm(join(repo, "skillerie.yaml"));

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: a user-facing diagnostic replaces a filesystem exception.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "config.read",
      file: join(repo, "skillerie.yaml"),
      jsonPath: "",
    }),
  );
});

it("returns a YAML diagnostic when the document is malformed", async () => {
  // Given: an unclosed flow sequence.
  const repo = await configRepo("version: 1\nstarter: [\n");

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: parsing fails without a thrown user error.
  expect(result.config).toBeUndefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "config.yaml",
      file: join(repo, "skillerie.yaml"),
      line: expect.any(Number),
    }),
  );
});

it("returns a YAML diagnostic when an alias recursively contains itself", async () => {
  // Given: a recursive graph that cannot become JSON-compatible configuration.
  const repo = await configRepo(
    "version: 1\nharnesses:\n  pi:\n    options: &loop\n      self: *loop\n",
  );

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: the non-JSON graph is rejected without overflowing schema validation.
  expect(result.config).toBeUndefined();
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "config.yaml" }));
});
