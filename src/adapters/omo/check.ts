import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { delimiter, join } from "node:path";
import { Ajv } from "ajv";
import { fullFormats } from "ajv-formats/dist/formats.js";
import { parse } from "jsonc-parser";
import type { Diagnostic, JsonObject, ResolvedContext } from "../../core/types.js";
import { isJsonObject } from "../../model/json.js";
import { renderConfig } from "./configuration.js";
import { renderAgents } from "./documents.js";

type SchemaResult =
  | { readonly kind: "available"; readonly schema: JsonObject }
  | { readonly kind: "unavailable"; readonly reason: string };

const schemas = new Map<string, Promise<SchemaResult>>();

async function schemaAt(address: string): Promise<SchemaResult> {
  const cached = schemas.get(address);
  if (cached !== undefined) return cached;
  const loading = new Promise<SchemaResult>((resolve) => {
    let url: URL;
    try {
      url = new URL(address);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      resolve({ kind: "unavailable", reason: "The schema URL is invalid." });
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      resolve({ kind: "unavailable", reason: "The schema URL must use HTTP or HTTPS." });
      return;
    }
    const get = url.protocol === "https:" ? httpsGet : httpGet;
    const request = get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        resolve({ kind: "unavailable", reason: "The schema endpoint is unavailable." });
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          request.destroy(new RangeError("Schema exceeds the size limit."));
        } else chunks.push(chunk);
      });
      response.on("error", (error: Error) =>
        resolve({ kind: "unavailable", reason: error.message }),
      );
      response.on("end", () => {
        try {
          const schema: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve(
            isJsonObject(schema)
              ? { kind: "available", schema }
              : { kind: "unavailable", reason: "The schema is not a JSON object." },
          );
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          resolve({ kind: "unavailable", reason: "The schema is not valid JSON." });
        }
      });
    });
    const deadline = setTimeout(
      () => request.destroy(new Error("Schema request timed out.")),
      5000,
    );
    request.on("close", () => clearTimeout(deadline));
    request.on("error", (error: Error) => resolve({ kind: "unavailable", reason: error.message }));
  });
  schemas.set(address, loading);
  return loading;
}

async function executablePresent(ctx: ResolvedContext): Promise<boolean> {
  const executable = ctx.harnessVersion.executable;
  const paths =
    executable === undefined
      ? (ctx.env["PATH"] ?? "")
          .split(delimiter)
          .filter(Boolean)
          .map((dir) => join(dir, "omo"))
      : [executable];
  for (const path of paths) {
    try {
      await access(path, constants.X_OK);
      return true;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error)) throw error;
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR" && error.code !== "EACCES")
        throw error;
    }
  }
  return false;
}

/** Schema checks are headless; the CLI doctor also prepares installs, so is not run. */
export async function check(ctx: ResolvedContext): Promise<readonly Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const content: unknown = parse(renderConfig(ctx, renderAgents(ctx, diagnostics), diagnostics));
  const address = isJsonObject(content) ? content["$schema"] : undefined;
  if (typeof address === "string") {
    const result = await schemaAt(address);
    switch (result.kind) {
      case "available": {
        try {
          const ajv = new Ajv({ allErrors: true, strict: false });
          for (const [name, format] of Object.entries(fullFormats)) ajv.addFormat(name, format);
          const validate = ajv.compile(result.schema);
          if (!validate(content)) {
            diagnostics.push(
              ...(validate.errors ?? []).map((error) => ({
                severity: "error" as const,
                code: "omo.schema",
                message: error.message ?? "Invalid OMO configuration.",
                jsonPath: error.instancePath,
              })),
            );
          }
        } catch (error) {
          if (!(error instanceof Error)) throw error;
          diagnostics.push({
            severity: "warn",
            code: "omo.schemaUnavailable",
            message: `Schema validation unavailable; configuration was parsed only. ${error.message}`,
          });
        }
        break;
      }
      case "unavailable":
        diagnostics.push({
          severity: "warn",
          code: "omo.schemaUnavailable",
          message: `Configuration was parsed only. ${result.reason}`,
        });
        break;
      default:
        return unreachable(result);
    }
  } else {
    diagnostics.push({
      severity: "warn",
      code: "omo.schemaUnavailable",
      message: "No published $schema URL was supplied; configuration was parsed only.",
    });
  }
  diagnostics.push(
    (await executablePresent(ctx))
      ? {
          severity: "info",
          code: "omo.cli.skipped",
          message: "OMO has no read-only CLI config validator; headless schema checks were used.",
        }
      : {
          severity: "info",
          code: "omo.cli.absent",
          message: "OMO CLI is absent; native CLI validation was skipped.",
        },
  );
  return diagnostics;
}

function unreachable(value: never): never {
  throw new TypeError(`Unknown schema result: ${String(value)}`);
}
