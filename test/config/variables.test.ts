import { join } from "node:path";
import { expect, it } from "vitest";
import { expandVariables, loadConfig } from "../../src/config/index.js";
import { configRepo, env } from "./fixture.js";

const vars = {
  repo: "/home/alice/repo",
  home: "/home/alice",
  paths: { docs: "/home/alice/notes" },
};

it.each([
  ["~", "/home/alice"],
  ["~/docs", "/home/alice/docs"],
  ["prefix/~/docs", "prefix/~/docs"],
  ["${repo}/bin", "/home/alice/repo/bin"],
  ["${home}/docs", "/home/alice/docs"],
  ["${paths.docs}/guide", "/home/alice/notes/guide"],
  ["${repo}:${home}:${paths.docs}", "/home/alice/repo:/home/alice:/home/alice/notes"],
  ["$${repo}", "${repo}"],
  ["$${unknown}", "${unknown}"],
  ["$${paths.missing}", "${paths.missing}"],
  ["$${repo}/${home}", "${repo}//home/alice"],
  ["{env:DOCS} {file:settings} $DOCS", "{env:DOCS} {file:settings} $DOCS"],
] as const)("expands %s without interpreting native or escaped placeholders", (value, expected) => {
  // Given: supported variables and an authored string.
  const input = value;

  // When: the string is expanded once.
  const result = expandVariables(input, vars);

  // Then: only supported unescaped variable syntax is expanded.
  expect(result).toEqual({ value: expected, diagnostics: [] });
});

it.each(["${unknown}", "${paths.missing}", "${paths.toString}", "${HOME}", "${}"])(
  "returns a diagnostic when %s is unknown",
  (value) => {
    // Given: an unrecognized variable.
    const input = value;

    // When: expansion is requested.
    const result = expandVariables(input, vars);

    // Then: the failure is explicit and does not silently erase the placeholder.
    expect(result.value).toBe(value);
    expect(result.diagnostics).toMatchObject([{ severity: "error", code: "config.variable" }]);
  },
);

it("does not recursively expand replacement values when they contain placeholders", () => {
  // Given: a replacement containing another variable's syntax.
  const input = "${repo}";

  // When: expansion substitutes the configured replacement.
  const result = expandVariables(input, {
    ...vars,
    repo: "/home/alice/$${home}",
  });

  // Then: the inserted text is not interpreted as author syntax again.
  expect(result).toEqual({ value: "/home/alice/$${home}", diagnostics: [] });
});

it("resolves named paths when dependencies are declared later", async () => {
  // Given: a forward reference and a transitive reference to a relative path.
  const repo = await configRepo(
    "version: 1\npaths:\n  guide: ${paths.docs}/guide\n  docs: ${paths.root}/docs\n  root: content\n",
  );

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: all path variables refer to fully resolved absolute paths.
  expect(result.config?.paths).toMatchObject({
    root: join(repo, "content"),
    docs: join(repo, "content/docs"),
    guide: join(repo, "content/docs/guide"),
  });
});

it("preserves escaped variables in named paths when defaults are resolved", async () => {
  // Given: a path containing a deliberately literal unknown variable.
  const repo = await configRepo("version: 1\npaths:\n  docs: ./$${unknown}\n");

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: the escape prevents both expansion and unknown-variable errors.
  expect(result.diagnostics).toEqual([]);
  expect(result.config?.paths.docs).toBe(join(repo, "${unknown}"));
});

it("reports a cycle when named paths reference each other", async () => {
  // Given: two paths with no acyclic resolution.
  const repo = await configRepo(
    "version: 1\npaths:\n  docs: ${paths.root}\n  root: ${paths.docs}\n",
  );

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: path resolution terminates with a located diagnostic.
  expect(result.config).toBeUndefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "config.pathCycle",
      jsonPath: "/paths/docs",
      line: 3,
    }),
  );
});

it("reports the string location when a nested value references an unknown variable", async () => {
  // Given: an unsupported variable in a deeply nested array.
  const repo = await configRepo(
    "version: 1\nharnesses:\n  pi:\n    options:\n      args: [ok, '${missing}']\n",
  );

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: the error points at the value, not just the enclosing document.
  expect(result.config).toBeUndefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "config.variable",
      jsonPath: "/harnesses/pi/options/args/1",
      file: join(repo, "skillerie.yaml"),
      line: 5,
    }),
  );
});

it("expands string values but not mapping keys when loading configuration", async () => {
  // Given: a key containing variable syntax and values with every supported source.
  const repo = await configRepo(
    "version: 1\nharnesses:\n  pi:\n    options:\n      '${unknown}': ['${repo}/bin', '${paths.docs}', '$${home}', '{env:DOCS}', '$DOCS']\n",
  );

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: only the parsed string values are substituted.
  expect(result.config?.harnesses.pi?.options["${unknown}"]).toEqual([
    join(repo, "bin"),
    "/home/alice/docs",
    "${home}",
    "{env:DOCS}",
    "$DOCS",
  ]);
});

it("preserves escaped variables when OMO has an explicit agent directory", async () => {
  // Given: a literal variable in an opted-in OMO option.
  const repo = await configRepo(
    "version: 1\nharnesses:\n  omo:\n    options:\n      agentDir: ./$${repo}\n",
  );

  // When: configuration is loaded.
  const result = await loadConfig(repo, env);

  // Then: normalization does not expand an already expanded value a second time.
  expect(result.config?.harnesses.omo?.options["agentDir"]).toBe(join(repo, "${repo}"));
});
