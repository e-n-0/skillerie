import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Diagnostic, ResolvedContext } from "../../src/core/types.js";
import { syncRepo, validateRepo } from "../../src/engine/index.js";
import { runDoctor } from "../../src/doctor/index.js";
import { adapters, fakeAdapter } from "../engine/helpers.js";
import { assertNever, externalFixture, skill } from "./helpers.js";

let sample: Awaited<ReturnType<typeof externalFixture>>;
let sha: string;
let origin: string;
beforeEach(async () => {
  sample = await externalFixture();
  await sample.put(
    join(sample.remote, "skills/review/SKILL.md"),
    skill("review", "Ask the user for details.\n"),
  );
  await sample.put(join(sample.remote, "skills/review/reference.json"), "{ broken");
  sha = await sample.commit();
  origin = `${sample.url}@${sha.slice(0, 7)}/skills/review`;
  await sample.configure([{ url: sample.url, ref: sha, path: "skills/review" }]);
});
afterEach(async () => {
  await sample.cleanup();
});

it("uses origin locations when validation reports external lint and support findings", async () => {
  // Given: an external skill and support file with warning-level findings.
  const options = { env: sample.env };
  // When: validation returns diagnostics after all source reads.
  const result = await validateRepo(sample.repo, options);
  // Then: only diagnostic locations change; internal source paths still read real files.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "lint.question.prose",
      severity: "warn",
      file: `${origin}/SKILL.md`,
      jsonPath: "/body",
    }),
  );
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "source.json",
      severity: "warn",
      file: `${origin}/reference.json`,
      line: 1,
    }),
  );
  expect(JSON.stringify(result.diagnostics)).not.toContain(join(sample.root, "cache"));
  const file = result.model?.skills[0]?.file;
  expect(file).toContain(join(sample.root, "cache"));
  expect(await readFile(file ?? "", "utf8")).toBe(skill("review", "Ask the user for details.\n"));
});

it.each(["validate", "sync", "install", "status", "doctor"])(
  "prints external origins when %s emits human diagnostics",
  async (command) => {
    // Given: cached content, allowing doctor to remain offline.
    await sample.command(["sync"]);
    // When: the real CLI runs the selected command.
    const result = await sample.command([command], {
      env: command === "doctor" ? { ...sample.env, PATH: "" } : sample.env,
    });
    // Then: diagnostic output contains the external origin and no machine cache location.
    expect(result.stderr).toContain(`${origin}/SKILL.md#/body lint.question.prose`);
    expect(result.stderr).not.toContain(join(sample.root, "cache"));
  },
);

it.each(["validate", "sync", "install", "status", "doctor"])(
  "serializes external origins when %s emits JSON diagnostics",
  async (command) => {
    // Given: cached external content with lint and support findings.
    await sample.command(["sync"]);
    // When: the real CLI serializes the command result.
    const result = await sample.command([command, "--json"], {
      env: command === "doctor" ? { ...sample.env, PATH: "" } : sample.env,
    });
    // Then: JSON uses the same location contract as human diagnostics.
    expect(JSON.parse(result.stdout)).toMatchObject({
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "lint.question.prose",
          file: `${origin}/SKILL.md`,
          jsonPath: "/body",
        }),
      ]),
    });
    expect(result.stdout).not.toContain(`${join(sample.root, "cache")}/external`);
  },
);

it("uses origin locations when external frontmatter fails before a model is produced", async () => {
  // Given: invalid external frontmatter in a resolved checkout.
  await sample.put(join(sample.remote, "skills/review/SKILL.md"), "---\nname: [broken\n---\n");
  const revision = await sample.commit();
  await sample.configure([{ url: sample.url, ref: revision, path: "skills/review" }]);
  // When: discovery fails before returning a model.
  const result = await validateRepo(sample.repo, { env: sample.env });
  // Then: error locations can still be mapped from resolved repository provenance.
  expect(result.model).toBeUndefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: "error",
      file: `${sample.url}@${revision.slice(0, 7)}/skills/review/SKILL.md`,
    }),
  );
  expect(JSON.stringify(result.diagnostics)).not.toContain(join(sample.root, "cache"));
});

it.each(["sync", "doctor"] as const)(
  "maps adapter findings when %s emits a diagnostic after validation",
  async (command) => {
    // Given: an adapter reports a support file using its real filesystem location.
    const { model, snapshot } = await validateRepo(sample.repo, { env: sample.env });
    if (!model || !snapshot) throw new TypeError("External fixture must validate.");
    const report = async (context: ResolvedContext): Promise<readonly Diagnostic[]> => {
      const support = context.model.skills[0]?.supportFiles[0];
      if (!support) throw new TypeError("External fixture must have a support file.");
      return [
        {
          severity: "warn",
          code: "adapter.external-source",
          message: "Adapter source finding.",
          file: support.sourcePath,
          jsonPath: "/adapter",
        },
      ];
    };
    const registry = adapters({
      ...fakeAdapter(),
      render: async (context) => ({ files: [], diagnostics: await report(context), metadata: {} }),
      doctor: report,
    });
    // When: the command completes its adapter work.
    let diagnostics: readonly Diagnostic[];
    switch (command) {
      case "sync":
        diagnostics = (await syncRepo(sample.repo, { env: sample.env, adapters: registry }))
          .diagnostics;
        break;
      case "doctor":
        diagnostics = await runDoctor({
          snapshot,
          model,
          env: sample.env,
          adapters: registry,
          findExecutable: async () => undefined,
        });
        break;
      default:
        assertNever(command);
    }
    // Then: later findings use the same origin contract as initial lint findings.
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: "adapter.external-source",
        file: `${origin}/reference.json`,
        jsonPath: "/adapter",
      }),
    );
  },
);
