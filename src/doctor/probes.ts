import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEngineVersion } from "../engine/compatibility.js";

export type ExecutableLookup = (
  name: string,
  pathValue: string | undefined,
  cwd: string,
) => Promise<string | undefined>;

export type VersionProbe = (executable: string) => Promise<string | undefined>;

export type HomeAccess =
  | { readonly writable: true; readonly checkedPath: string }
  | {
      readonly writable: false;
      readonly checkedPath: string;
      readonly reason: "not-directory" | "not-writable";
    };

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export async function findExecutable(
  name: string,
  pathValue: string | undefined,
  cwd: string,
): Promise<string | undefined> {
  const pathLike = isAbsolute(name) || name.includes("/") || name.includes("\\");
  const candidates = pathLike
    ? [resolve(cwd, name)]
    : pathValue === undefined
      ? []
      : pathValue.split(delimiter).map((directory) => join(directory || cwd, name));

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if (!["ENOENT", "EACCES", "EPERM", "ENOTDIR"].includes(errorCode(error) ?? "")) throw error;
    }
  }
  return undefined;
}

export function probeExecutableVersion(executable: string): Promise<string | undefined> {
  return new Promise((resolveOutput) => {
    execFile(
      executable,
      ["--version"],
      { encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024 },
      (_error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`.trim();
        resolveOutput(output.length > 0 ? output : undefined);
      },
    );
  });
}

export async function homeAccess(path: string): Promise<HomeAccess> {
  let candidate = resolve(path);
  while (true) {
    try {
      const information = await stat(candidate);
      if (!information.isDirectory())
        return { writable: false, checkedPath: candidate, reason: "not-directory" };
      await access(candidate, constants.W_OK);
      return { writable: true, checkedPath: candidate };
    } catch (error) {
      const code = errorCode(error);
      if (code === "ENOENT") {
        const parent = dirname(candidate);
        if (parent === candidate)
          return { writable: false, checkedPath: candidate, reason: "not-writable" };
        candidate = parent;
        continue;
      }
      if (code === "ENOTDIR")
        return { writable: false, checkedPath: candidate, reason: "not-directory" };
      if (code === "EACCES" || code === "EPERM")
        return { writable: false, checkedPath: candidate, reason: "not-writable" };
      throw error;
    }
  }
}

export async function packageNodeRange(): Promise<{
  readonly file: string;
  readonly range: string;
}> {
  const file = fileURLToPath(new URL("../../package.json", import.meta.url));
  const manifest: unknown = JSON.parse(await readFile(file, "utf8"));
  if (typeof manifest !== "object" || manifest === null)
    throw new TypeError("package.json must contain an object");
  const engines = Reflect.get(manifest, "engines");
  if (typeof engines !== "object" || engines === null)
    throw new TypeError("package.json must declare engines.node");
  const range = Reflect.get(engines, "node");
  if (typeof range !== "string") throw new TypeError("package.json must declare engines.node");
  return { file, range };
}

export function versionSatisfies(range: string, version: string): boolean {
  return checkEngineVersion(range, version, "package.json").length === 0;
}

export function extractVersion(output: string): string | undefined {
  return /(?:^|[^\d])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?![0-9A-Za-z.-])/.exec(
    output,
  )?.[1];
}
