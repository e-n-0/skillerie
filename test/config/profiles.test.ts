import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadConfig } from "../../src/config/index.js";
import { configRepo, env } from "./fixture.js";

const entityKinds = ["skills", "agents", "rules", "assets"] as const;
const selectionKinds = [...entityKinds, "mcp"] as const;

it("applies the first profile when no profile is requested", async () => {
  // Given: profiles whose authored order differs from alphabetical order.
  const repo = await configRepo(
    "version: 1\nprofiles:\n  work: { skills: { disabled: [personal] } }\n  personal: { skills: { disabled: [work] } }\n",
  );

  // When: configuration is loaded without a profile option.
  const result = await loadConfig(repo, env);

  // Then: the first profile is applied and the author-only mapping is removed.
  expect(result.diagnostics).toEqual([]);
  expect(result.config?.profile).toBe("work");
  expect(result.config?.skills.disabled).toEqual(["personal"]);
  expect(Object.hasOwn(result.config ?? {}, "profiles")).toBe(false);
});

it("applies the requested profile when it is not the default", async () => {
  // Given: two profiles with different entity and MCP selections.
  const repo = await configRepo(
    "version: 1\nprofiles:\n  work: { skills: { disabled: [personal] } }\n  personal: { skills: { disabled: [work] }, mcp: { enabled: [docs] } }\n",
  );

  // When: the second profile is explicitly selected.
  const result = await loadConfig(repo, env, { profile: "personal" });

  // Then: only that profile contributes to the resolved selection.
  expect(result.diagnostics).toEqual([]);
  expect(result.config).toMatchObject({
    profile: "personal",
    skills: { disabled: ["work"] },
    mcp: { enabled: ["docs"], disabled: [], harnesses: {} },
  });
});

it.each(["missing", "toString"])(
  "rejects unknown profile %s with available choices",
  async (name) => {
    // Given: two profiles in authored order, neither matching the request.
    const repo = await configRepo("version: 1\nprofiles:\n  work: {}\n  personal: {}\n");

    // When: an unknown name is requested, including an inherited object property.
    const result = await loadConfig(repo, env, { profile: name });

    // Then: the failure includes the profile mapping's source location.
    expect(result.config).toBeUndefined();
    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        code: "config.profile.unknown",
        message: `Unknown profile "${name}". Available profiles: work, personal.`,
        file: join(repo, "skillerie.yaml"),
        jsonPath: "/profiles",
        line: 3,
      },
    ]);
  },
);

it("rejects an explicit profile when the configuration defines none", async () => {
  // Given: an existing configuration without profiles.
  const repo = await configRepo("version: 1\n");

  // When: a profile is explicitly requested.
  const result = await loadConfig(repo, env, { profile: "work" });

  // Then: the missing mapping is diagnosed at the document root.
  expect(result.config).toBeUndefined();
  expect(result.diagnostics).toEqual([
    {
      severity: "error",
      code: "config.profile.unknown",
      message: 'Profile "work" is not defined; skillerie.yaml has no profiles.',
      file: join(repo, "skillerie.yaml"),
      jsonPath: "",
      line: 1,
    },
  ]);
});

it.each(["1", "Work", "work--home", "-work", "work_1"])(
  "rejects profile name %s at the schema boundary",
  async (name) => {
    // Given: a profile name outside the ordered-name contract.
    const repo = await configRepo(`version: 1\nprofiles:\n  "${name}": {}\n`);

    // When: the configuration is loaded.
    const result = await loadConfig(repo, env);

    // Then: schema validation rejects the name before profile choice.
    expect(result.config).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "config.schema", jsonPath: "/profiles" }),
    );
  },
);

it.each([
  ["profiles: {}", "/profiles"],
  ["profiles: { work: { paths: { docs: elsewhere } } }", "/profiles/work/paths"],
  ["profiles: { work: { skills: { external: [] } } }", "/profiles/work/skills/external"],
  [
    "profiles: { work: { harnesses: { codex: { path: elsewhere } } } }",
    "/profiles/work/harnesses/codex/path",
  ],
  [
    "profiles: { work: { harnesses: { codex: { options: {} } } } }",
    "/profiles/work/harnesses/codex/options",
  ],
  [
    "profiles: { work: { harnesses: { codex: { enabled: yes } } } }",
    "/profiles/work/harnesses/codex/enabled",
  ],
  ["mcp: { overrides: {} }", "/mcp/overrides"],
  ["mcp: { harnesses: { codex: { overrides: {} } } }", "/mcp/harnesses/codex/overrides"],
  ["mcp: { harnesses: { other: {} } }", "/mcp/harnesses/other"],
  ["profiles: { work: { mcp: { overrides: {} } } }", "/profiles/work/mcp/overrides"],
])("rejects unsupported profile or MCP data in %s", async (source, jsonPath) => {
  // Given: data outside the restricted profile and MCP shapes.
  const repo = await configRepo(`version: 1\n${source}\n`);

  // When: the configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: schema validation identifies the rejected field.
  expect(result.config).toBeUndefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "config.schema", jsonPath }),
  );
});

it.each(selectionKinds)("unions disabled %s names globally and per harness", async (kind) => {
  // Given: overlapping disabled lists and profile allowlists trying to re-enable base names.
  const repo = await configRepo(
    JSON.stringify({
      version: 1,
      [kind]: {
        disabled: ["base", "shared"],
        harnesses: { codex: { disabled: ["local-base", "local-shared"] } },
      },
      profiles: {
        work: {
          [kind]: {
            enabled: ["base"],
            disabled: ["shared", "profile"],
            harnesses: {
              codex: { enabled: ["local-base"], disabled: ["local-shared", "local-profile"] },
            },
          },
        },
      },
    }),
  );

  // When: the profile is applied.
  const result = await loadConfig(repo, env);

  // Then: base exclusions survive and duplicate names appear only once.
  expect(result.diagnostics).toEqual([]);
  expect(result.config?.[kind]?.disabled).toEqual(["base", "shared", "profile"]);
  expect(result.config?.[kind]?.harnesses.codex?.disabled).toEqual([
    "local-base",
    "local-shared",
    "local-profile",
  ]);
});

it.each(selectionKinds)(
  "replaces nonempty enabled %s lists globally and per harness",
  async (kind) => {
    // Given: different nonempty base and profile allowlists at both levels.
    const repo = await configRepo(
      JSON.stringify({
        version: 1,
        [kind]: { enabled: ["base"], harnesses: { codex: { enabled: ["local-base"] } } },
        profiles: {
          work: {
            [kind]: { enabled: ["profile"], harnesses: { codex: { enabled: ["local-profile"] } } },
          },
        },
      }),
    );

    // When: the profile is applied.
    const result = await loadConfig(repo, env);

    // Then: profile allowlists replace, rather than concatenate with, base allowlists.
    expect(result.diagnostics).toEqual([]);
    expect(result.config?.[kind]?.enabled).toEqual(["profile"]);
    expect(result.config?.[kind]?.harnesses.codex?.enabled).toEqual(["local-profile"]);
  },
);

it.each(selectionKinds)(
  "retains enabled %s lists when the profile lists are empty",
  async (kind) => {
    // Given: base allowlists and explicit empty profile allowlists.
    const repo = await configRepo(
      JSON.stringify({
        version: 1,
        [kind]: { enabled: ["base"], harnesses: { codex: { enabled: ["local-base"] } } },
        profiles: { work: { [kind]: { enabled: [], harnesses: { codex: { enabled: [] } } } } },
      }),
    );

    // When: the profile is applied.
    const result = await loadConfig(repo, env);

    // Then: empty profile lists do not erase base allowlists.
    expect(result.diagnostics).toEqual([]);
    expect(result.config?.[kind]?.enabled).toEqual(["base"]);
    expect(result.config?.[kind]?.harnesses.codex?.enabled).toEqual(["local-base"]);
  },
);

it.each(entityKinds)(
  "shallowly merges %s overrides by name with profile fields winning",
  async (kind) => {
    // Given: overlapping names, disjoint names, and nested fields at both selection levels.
    const repo = await configRepo(
      JSON.stringify({
        version: 1,
        [kind]: {
          overrides: {
            debug: {
              description: "Base description",
              readOnly: true,
              metadata: { base: true },
              requires: { bin: "node", env: "BASE_ENV" },
            },
            retained: { enabled: false },
          },
          harnesses: {
            codex: {
              overrides: { debug: { maxTurns: 3, noShell: true, metadata: { base: true } } },
            },
          },
        },
        profiles: {
          work: {
            [kind]: {
              overrides: {
                debug: {
                  description: "Profile description",
                  metadata: { profile: true },
                  requires: { os: "darwin" },
                },
                added: { enabled: true },
              },
              harnesses: {
                codex: { overrides: { debug: { maxTurns: 7, metadata: { profile: true } } } },
              },
            },
          },
        },
      }),
    );

    // When: the profile is applied.
    const result = await loadConfig(repo, env);

    // Then: profile fields replace nested values while unrelated fields and names survive.
    expect(result.diagnostics).toEqual([]);
    expect(result.config?.[kind].overrides).toEqual({
      debug: {
        description: "Profile description",
        readOnly: true,
        metadata: { profile: true },
        requires: { os: "darwin" },
      },
      retained: { enabled: false },
      added: { enabled: true },
    });
    expect(result.config?.[kind].harnesses.codex?.overrides).toEqual({
      debug: { maxTurns: 7, noShell: true, metadata: { profile: true } },
    });
  },
);

it("merges harness enabled flags without changing base paths or options", async () => {
  // Given: enabled and disabled base harnesses, and a profile enabling an absent harness.
  const repo = await configRepo(
    JSON.stringify({
      version: 1,
      harnesses: {
        opencode: { enabled: false, path: "./runtime", options: { custom: true } },
        codex: { enabled: true },
        omo: { enabled: false },
      },
      profiles: {
        work: {
          harnesses: {
            opencode: { enabled: true },
            codex: { enabled: false },
            pi: { enabled: true },
          },
        },
      },
    }),
  );

  // When: the profile is applied before path normalization.
  const result = await loadConfig(repo, env);

  // Then: explicit profile flags win, unchanged flags survive, and missing paths default.
  expect(result.diagnostics).toEqual([]);
  expect(result.config?.harnesses).toEqual({
    opencode: { enabled: true, path: join(repo, "runtime"), options: { custom: true } },
    codex: { enabled: false, path: "/home/alice/.codex", options: {} },
    omo: {
      enabled: false,
      path: "/home/alice/.omo",
      options: { agentDir: "/home/alice/.omo/agent" },
    },
    pi: { enabled: true, path: "/home/alice/.pi/agent", options: {} },
  });
});

it("preserves base external skills when a profile changes skill selection", async () => {
  // Given: external skills declared only in the base configuration.
  const external = [{ url: "https://example.com/skills.git", include: ["debug"] }];
  const repo = await configRepo(
    JSON.stringify({
      version: 1,
      skills: { external },
      profiles: { work: { skills: { disabled: ["personal"] } } },
    }),
  );

  // When: the profile is applied.
  const result = await loadConfig(repo, env);

  // Then: the profile selection does not discard external source declarations.
  expect(result.diagnostics).toEqual([]);
  expect(result.config?.skills.external).toEqual(external);
});

it("normalizes top-level MCP selection when no profiles are defined", async () => {
  // Given: only a base MCP selection.
  const repo = await configRepo(
    "version: 1\nmcp: { disabled: [tracker], harnesses: { codex: { enabled: [docs] } } }\n",
  );

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: MCP defaults are filled without inventing an applied profile.
  expect(result.diagnostics).toEqual([]);
  expect(result.config?.mcp).toEqual({
    enabled: [],
    disabled: ["tracker"],
    harnesses: { codex: { enabled: ["docs"], disabled: [] } },
  });
  expect(Object.hasOwn(result.config ?? {}, "profile")).toBe(false);
});

it("retains a per-harness MCP entry when global selection lists are empty", async () => {
  // Given: a profile declaring a harness selection without global filters.
  const repo = await configRepo(
    "version: 1\nprofiles:\n  work-1: { mcp: { harnesses: { pi: {} } } }\n",
  );

  // When: the profile is applied.
  const result = await loadConfig(repo, env);

  // Then: an authored harness entry carries information and is not omitted.
  expect(result.diagnostics).toEqual([]);
  expect(result.config?.profile).toBe("work-1");
  expect(result.config?.mcp).toEqual({
    enabled: [],
    disabled: [],
    harnesses: { pi: { enabled: [], disabled: [] } },
  });
});

it.each(["", "mcp: {}\n", "mcp: { enabled: [], disabled: [], harnesses: {} }\n"])(
  "omits both optional own keys when no profile or MCP information exists in %s",
  async (source) => {
    // Given: a configuration with no profiles and absent or empty MCP selection.
    const repo = await configRepo(`version: 1\n${source}`);

    // When: configuration is loaded.
    const result = await loadConfig(repo, env);

    // Then: absent information is omitted rather than emitted as undefined or empty defaults.
    expect(result.diagnostics).toEqual([]);
    expect(result.config).toBeDefined();
    expect(Object.hasOwn(result.config ?? {}, "profile")).toBe(false);
    expect(Object.hasOwn(result.config ?? {}, "mcp")).toBe(false);
  },
);

it("preserves resolved JSON when empty defaults are explicitly authored without profiles", async () => {
  // Given: a baseline load and the same repository with explicit empty selection settings.
  const repo = await configRepo("version: 1\n");
  const baseline = await loadConfig(repo, env);
  await writeFile(
    join(repo, "skillerie.yaml"),
    "version: 1\nharnesses: {}\nskills: {}\nagents: {}\nrules: {}\nassets: {}\n",
  );

  // When: the explicit empty configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: the serialized config, including optional-field absence, is unchanged.
  expect(result.diagnostics).toEqual([]);
  expect(JSON.stringify(result.config)).toBe(JSON.stringify(baseline.config));
});

it("discards unselected profiles before variable expansion", async () => {
  // Given: an unselected profile containing an unresolved variable.
  const repo = await configRepo(
    "version: 1\nprofiles:\n  work: { agents: { overrides: { debug: { description: '${paths.docs}' } } } }\n  personal: { agents: { overrides: { debug: { description: '${missing}' } } } }\n",
  );

  // When: the first profile is applied and its values are expanded.
  const result = await loadConfig(repo, env);

  // Then: only the selected profile participates in expansion.
  expect(result.diagnostics).toEqual([]);
  expect(result.config?.agents.overrides["debug"]?.description).toBe("/home/alice/docs");
});
