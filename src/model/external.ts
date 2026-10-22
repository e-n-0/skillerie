import { basename, join, relative } from "node:path";
import { lstat, readdir } from "node:fs/promises";
import type { Diagnostic, ResolvedConfig, ResolvedExternalSkill, Skill } from "../core/types.js";
import { readSkills } from "./entities.js";
import { ignored, readTree, relativePath, type SourceFile } from "./files.js";

/** External checkouts are read here, never fetched or modified by the model. */
export async function readExternalSkills(
  entries: readonly ResolvedExternalSkill[],
  config: ResolvedConfig,
  localSkills: readonly Skill[],
) {
  const diagnostics: Diagnostic[] = [];
  const skills: Skill[] = [];
  const files = new Map<string, SourceFile>();
  const names = new Set(localSkills.map((skill) => skill.name.toLowerCase()));
  for (const entry of entries) {
    const root = join(entry.directory, entry.revision.path);
    const location = {
      file: join(config.paths.repo, "skillerie.yaml"),
      jsonPath: `/skills/external/${entry.index}`,
    };
    let single: boolean;
    const immediate: string[] = [];
    try {
      let directory = entry.directory;
      let redirected = false;
      for (const part of entry.revision.path.split("/").filter(Boolean)) {
        directory = join(directory, part);
        if ((await lstat(directory)).isSymbolicLink()) {
          diagnostics.push({
            severity: "error",
            code: "source.symlink",
            message: "Source links are not supported.",
            file: directory,
            line: 1,
          });
          redirected = true;
          break;
        }
      }
      if (redirected) continue;
      const children = await readdir(root, { withFileTypes: true });
      single = children.some((child) => child.name === "SKILL.md" && !child.isDirectory());
      if (!single) {
        for (const child of children) {
          if (!child.isDirectory() || ignored(child.name)) continue;
          const directory = join(root, child.name);
          if ((await readdir(directory)).includes("SKILL.md")) immediate.push(directory);
        }
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      diagnostics.push({
        severity: "error",
        code: "external.path",
        message: `${entry.revision.url}: ${error.message}`,
        ...location,
        jsonPath: `${location.jsonPath}/path`,
      });
      continue;
    }
    const selected = single
      ? [root]
      : immediate.filter(
          (path) => entry.include === undefined || entry.include.includes(basename(path)),
        );
    if (!single) {
      for (const [index, name] of (entry.include ?? []).entries()) {
        if (immediate.some((path) => basename(path) === name)) continue;
        diagnostics.push({
          severity: "error",
          code: "external.include",
          message: `Unknown external skill "${name}" in ${entry.revision.url}.`,
          ...location,
          jsonPath: `${location.jsonPath}/include/${index}`,
        });
      }
    }
    if (!single && immediate.length === 0)
      diagnostics.push({
        severity: "error",
        code: "external.skill-missing",
        message: `No SKILL.md or immediate skill directories at ${entry.revision.url}/${entry.revision.path}.`,
        ...location,
        jsonPath: `${location.jsonPath}/path`,
      });
    const inventory: SourceFile[] = [];
    for (const directory of selected) inventory.push(...(await readTree(directory, diagnostics)));
    const discovered = readSkills(inventory, {
      source: "external",
      skillRoots: selected,
      ...(single ? { namedRoot: root } : {}),
      diagnostics,
    });
    for (const skill of discovered) {
      if (names.has(skill.name.toLowerCase()) && !config.skills.disabled.includes(skill.name))
        diagnostics.push({
          severity: "error",
          code: "external.collision",
          message: `External skill "${skill.name}" collides with another skill. Use skills.disabled or external include to exclude it.`,
          ...location,
        });
      names.add(skill.name.toLowerCase());
      skills.push({
        ...skill,
        external: { ...entry.revision, path: relativePath(entry.directory, skill.dir) },
      });
      const paths = new Set([
        skill.file,
        ...skill.supportFiles.map((support) => support.sourcePath),
      ]);
      for (const file of inventory) {
        if (paths.has(file.sourcePath))
          files.set(
            `external/${entry.index}/${relativePath(entry.directory, file.sourcePath)}`,
            file,
          );
      }
    }
  }
  return { skills, files, diagnostics };
}

/** Display provenance without leaking the engine's cache layout. */
export function externalOrigin(skill: Skill): string | undefined {
  const origin = skill.external;
  return origin
    ? `${origin.url}@${origin.sha.slice(0, 8)}${origin.path ? `/${origin.path}` : ""}`
    : undefined;
}

/** Dialect paths describe the skill layout, not its physical checkout location. */
export function skillDirectory(skill: Skill, repoDir: string): string {
  return skill.external
    ? skill.external.path || `skills/${skill.name}`
    : relative(repoDir, skill.dir).replaceAll("\\", "/");
}
