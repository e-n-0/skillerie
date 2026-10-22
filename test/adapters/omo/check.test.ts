import { once } from "node:events";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { check } from "../../../src/adapters/omo/check.js";
import { setup, withTemplates } from "./helpers.js";

let sample: Awaited<ReturnType<typeof setup>>;
const servers: Server[] = [];
beforeEach(async () => {
  sample = await setup();
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  }
  await sample.cleanup();
});

async function schemaServer(status: number) {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(status, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        type: "object",
        properties: {
          "[native]": { type: "object", required: ["agents"] },
          requiredFlag: { type: "boolean" },
        },
        required: ["[native]", "requiredFlag"],
      }),
    );
  });
  servers.push(server);
  const ready = once(server, "listening");
  server.listen(0, "localhost");
  await ready;
  const address = server.address();
  if (address === null || typeof address === "string") throw new TypeError("Missing server port.");
  return { url: `http://localhost:${address.port}/schema.json`, requests: () => requests };
}

it("reports an info diagnostic when the CLI is absent", async () => {
  // Given: no executable lookup path and no published schema.
  const ctx = { ...sample.ctx, env: { HOME: sample.env["HOME"], PATH: "" } };
  // When: headless checks run.
  const diagnostics = await check(ctx);
  // Then: CLI validation is explicitly skipped instead of treated as a failure.
  expect(diagnostics).toContainEqual(
    expect.objectContaining({ severity: "info", code: "omo.cli.absent" }),
  );
  expect(diagnostics.some((item) => item.severity === "error")).toBe(false);
});

it("skips the mutating doctor when an OMO executable is present", async () => {
  // Given: an executable that would fail if invoked.
  const executable = join(sample.root, "omo");
  await writeFile(executable, "#!/bin/sh\nexit 99\n", { mode: 0o755 });
  const ctx = { ...sample.ctx, harnessVersion: { ...sample.ctx.harnessVersion, executable } };
  // When: check probes native validation support.
  const diagnostics = await check(ctx);
  // Then: the executable is not mistaken for a safe config validator.
  expect(diagnostics).toContainEqual(
    expect.objectContaining({ severity: "info", code: "omo.cli.skipped" }),
  );
  expect(diagnostics.some((item) => item.severity === "error")).toBe(false);
});

it("validates generated config and reuses schema bytes when a schema is reachable", async () => {
  // Given: a reachable schema that requires a field absent from generated config.
  const source = await schemaServer(200);
  const invalid = withTemplates(sample.ctx, { "omo.jsonc": { $schema: source.url } });
  const valid = withTemplates(sample.ctx, {
    "omo.jsonc": { $schema: source.url, requiredFlag: true },
  });
  // When: both configs are checked against that schema.
  const invalidDiagnostics = await check(invalid);
  const validDiagnostics = await check(valid);
  // Then: validation distinguishes the inputs and the schema endpoint is read only once.
  expect(invalidDiagnostics).toContainEqual(
    expect.objectContaining({ severity: "error", code: "omo.schema" }),
  );
  expect(validDiagnostics.some((item) => item.severity === "error")).toBe(false);
  expect(source.requests()).toBe(1);
});

it("falls back to parse-only checks when the schema endpoint is unavailable", async () => {
  // Given: a schema endpoint returning a failure status.
  const source = await schemaServer(503);
  const ctx = withTemplates(sample.ctx, { "omo.jsonc": { $schema: source.url } });
  // When: schema validation runs without a reachable schema.
  const diagnostics = await check(ctx);
  // Then: a warning records the limited validation without rejecting valid JSONC.
  expect(diagnostics).toContainEqual(
    expect.objectContaining({ severity: "warn", code: "omo.schemaUnavailable" }),
  );
  expect(diagnostics.some((item) => item.severity === "error")).toBe(false);
});

it("reports invalid JSONC when a template has malformed syntax", async () => {
  // Given: a directly supplied malformed template.
  const ctx = {
    ...sample.ctx,
    model: {
      ...sample.ctx.model,
      templates: {
        omo: {
          harness: "omo" as const,
          files: [
            {
              file: "omo.jsonc",
              relPath: "omo.jsonc",
              format: "jsonc" as const,
              content: '{"[native]":,}',
            },
          ],
        },
      },
    },
  };
  // When: check parses the source template.
  const diagnostics = await check(ctx);
  // Then: syntax errors are not hidden by schema fallback.
  expect(diagnostics).toContainEqual(
    expect.objectContaining({ severity: "error", code: "omo.template" }),
  );
});
