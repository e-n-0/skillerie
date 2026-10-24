import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { ScanContext } from "../../src/import/types.js";
import { hashFiles } from "../../src/import/shared.js";
import { scanSkillDirectories } from "../../src/import/skills.js";

let root = "";
let skillsDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "skillerie-import-skills-"));
  skillsDir = join(root, "home", ".config", "opencode", "skills");
  await mkdir(skillsDir, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

function context(managed: ScanContext["managed"] = () => false): ScanContext {
  return { env: { HOME: root }, managed };
}

const validSkill = (name: string) =>
  `---\nname: ${name}\ndescription: Use when ${name} is needed.\n---\nInstructions.\n`;

it("inventories sorted skill files and follows skill directory symlinks", async () => {
  // Given: regular and linked skills, ignored files, and a hidden built-in directory.
  const review = join(skillsDir, "review");
  const reviewMarkdown = validSkill("review");
  const guide = "Read the guide.\n";
  const check = "echo check\n";
  await put(join(review, "SKILL.md"), reviewMarkdown);
  await put(join(review, "guide.md"), guide);
  await put(join(review, "scripts", "check.sh"), check);
  await put(join(review, ".git", "config"), "ignored\n");
  await put(join(review, "__pycache__", "module.py"), "ignored\n");
  await put(join(review, ".DS_Store"), "ignored\n");
  await put(join(review, "module.pyc"), "ignored\n");
  await put(join(skillsDir, ".system", "builtin", "SKILL.md"), validSkill("builtin"));

  const linkedTarget = join(root, "linked-target");
  await put(join(linkedTarget, "SKILL.md"), validSkill("linked"));
  await symlink(linkedTarget, join(skillsDir, "linked"), "dir");

  // When: scanning the source location and a missing optional location.
  const result = await scanSkillDirectories(
    [
      { source: "opencode", dir: skillsDir },
      { source: "codex", dir: join(root, "missing") },
    ],
    context(),
  );

  // Then: both skills are found, files are sorted and filtered, and hashes use their bytes.
  expect(result.diagnostics).toEqual([]);
  expect(result.items.map(({ name }) => name)).toEqual(["linked", "review"]);
  expect(result.items.find(({ name }) => name === "review")).toEqual({
    kind: "skill",
    name: "review",
    source: "opencode",
    path: review,
    files: ["SKILL.md", "guide.md", "scripts/check.sh"],
    hash: hashFiles([
      { relPath: "SKILL.md", content: reviewMarkdown },
      { relPath: "guide.md", content: guide },
      { relPath: "scripts/check.sh", content: check },
    ]),
  });
  expect(result.items.find(({ name }) => name === "linked")).toMatchObject({
    path: join(skillsDir, "linked"),
    files: ["SKILL.md"],
  });
});

it("skips a managed skill directory", async () => {
  // Given: a skill linked into the source location that is already managed.
  const managedPath = join(skillsDir, "managed");
  const target = join(root, "managed-target");
  await put(join(target, "SKILL.md"), validSkill("managed"));
  await symlink(target, managedPath, "dir");

  // When: the managed callback identifies that path.
  const result = await scanSkillDirectories(
    [{ source: "opencode", dir: skillsDir }],
    context((path) => path === managedPath),
  );

  // Then: the linked item is omitted without diagnostics.
  expect(result).toEqual({ items: [], diagnostics: [] });
});

it("reports invalid skill frontmatter and skips those skills", async () => {
  // Given: malformed YAML and frontmatter missing a required description.
  const malformedPath = join(skillsDir, "malformed", "SKILL.md");
  const missingDescriptionPath = join(skillsDir, "missing-description", "SKILL.md");
  await put(malformedPath, "---\nname: malformed\ndescription: [\n---\n");
  await put(missingDescriptionPath, "---\nname: missing-description\n---\n");

  // When: scanning both invalid skills.
  const result = await scanSkillDirectories([{ source: "opencode", dir: skillsDir }], context());

  // Then: neither is imported and both produce importer warnings.
  expect(result.items).toEqual([]);
  expect(result.diagnostics).toHaveLength(2);
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        severity: "warn",
        code: "import.skill",
        file: malformedPath,
      }),
      expect.objectContaining({
        severity: "warn",
        code: "import.skill",
        file: missingDescriptionPath,
      }),
    ]),
  );
});
