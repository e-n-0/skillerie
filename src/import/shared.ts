import { createHash } from "node:crypto";
import { stringify } from "yaml";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Key order doesn't change the fingerprint, so translated configs from different harnesses match. */
export function hashJson(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function hashFiles(
  files: readonly { readonly relPath: string; readonly content: string | Buffer }[],
): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => (a.relPath < b.relPath ? -1 : 1))) {
    hash.update(file.relPath).update("\0").update(file.content).update("\0");
  }
  return hash.digest("hex");
}

export function hashText(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n").trimEnd()).digest("hex");
}

export function agentMarkdown(input: {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}): string {
  const frontmatter = stringify(
    { name: input.name, description: input.description },
    { lineWidth: 0 },
  );
  return `---\n${frontmatter}---\n${input.body.replace(/^\n+/, "").trimEnd()}\n`;
}
