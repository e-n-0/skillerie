import { createHash } from "node:crypto";
import type { HarnessId } from "../core/types.js";
import { CONFIG_VERSION } from "../version.js";

/** Generate the configuration repository's initial files. */
export function scaffoldFiles(
  harnesses: Readonly<Record<HarnessId, boolean>>,
  engineVersion: string,
  directory: string,
): Readonly<Record<string, string>> {
  const engineRange = `^${engineVersion.split(".").slice(0, 2).join(".")}`;
  const hash = createHash("sha256").update(directory).digest("hex");
  return {
    "skillerie.yaml": [
      "# yaml-language-server: $schema=./node_modules/skillerie/schema/skillerie.schema.json",
      `version: ${CONFIG_VERSION}`,
      "",
      "harnesses:",
      ...Object.entries(harnesses).flatMap(([name, enabled]) => [
        `  ${name}:`,
        `    enabled: ${enabled}`,
      ]),
      "",
      "# paths:",
      "#   docs: ~/docs",
      "#   backup: ~/.Trash/skillerie",
      `#   cache: ~/.cache/skillerie/${hash}`,
      "",
    ].join("\n"),
    "instructions.md": [
      "# Shared instructions",
      "",
      "Describe your coding conventions, preferred tools, and verification steps here.",
      "",
    ].join("\n"),
    "skills/.gitkeep": "",
    "agents/.gitkeep": "",
    "rules/.gitkeep": "",
    "mcp.json": '{"mcpServers":{}}\n',
    ".gitignore": "generated/\n",
    "package.json": `${JSON.stringify(
      { private: true, devDependencies: { skillerie: engineRange } },
      null,
      2,
    )}\n`,
  };
}
