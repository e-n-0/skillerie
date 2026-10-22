import type { ErrorObject } from "ajv";
import { isNode, LineCounter, parseDocument } from "yaml";
import type { Diagnostic } from "../core/types.js";
import { pointerSegment } from "./variables.js";

/** Keep the parsed tree alongside diagnostics so JSON pointers retain source lines. */
export function configDocument(source: string, file: string) {
  const counter = new LineCounter();
  const document = parseDocument(source, {
    version: "1.2",
    schema: "core",
    uniqueKeys: true,
    stringKeys: true,
    resolveKnownTags: false,
    lineCounter: counter,
  });
  const location = (jsonPath: string) => {
    const segments =
      jsonPath === ""
        ? []
        : jsonPath
            .slice(1)
            .split("/")
            .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
    let node = document.getIn(segments, true);
    while (!isNode(node) && segments.length > 0) {
      segments.pop();
      node = document.getIn(segments, true);
    }
    const offset = isNode(node) ? (node.range?.[0] ?? 0) : 0;
    return { file, jsonPath, line: counter.linePos(offset).line };
  };
  const diagnostics: Diagnostic[] = [...document.errors, ...document.warnings].map((error) => ({
    severity: "error",
    code: error.code === "DUPLICATE_KEY" ? "config.duplicateKey" : "config.yaml",
    message: error.message,
    file,
    line: counter.linePos(error.pos[0]).line,
  }));
  if (document.directives.yaml.version !== "1.2") {
    diagnostics.push({
      severity: "error",
      code: "config.yamlVersion",
      message: "Configuration requires YAML 1.2.",
      ...location(""),
    });
  }

  const schemaDiagnostic = (error: ErrorObject): Diagnostic => {
    const property: unknown = error.params["additionalProperty"] ?? error.params["missingProperty"];
    const jsonPath =
      typeof property === "string"
        ? `${error.instancePath}/${pointerSegment(property)}`
        : error.instancePath;
    const version =
      error.keyword === "const" && (jsonPath === "/version" || jsonPath === "/dialect");
    return {
      severity: "error",
      code: version ? "config.unsupportedVersion" : "config.schema",
      message: version
        ? `Unsupported ${jsonPath.slice(1)}; this engine supports version 1. Upgrade skillerie to read newer versions.`
        : `${jsonPath || "/"} ${error.message ?? "does not match the configuration schema"}.`,
      ...location(jsonPath),
    };
  };
  return { document, diagnostics, location, schemaDiagnostic };
}
