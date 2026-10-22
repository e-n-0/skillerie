import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import type { Environment } from "../../src/core/types.js";

export const env: Environment = { HOME: "/home/alice" };
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

export async function configRepo(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "skillerie-config-"));
  directories.push(directory);
  await writeFile(join(directory, "skillerie.yaml"), source);
  return directory;
}
