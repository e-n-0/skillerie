import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stringify } from "yaml";
import { runCli } from "../../src/cli.js";
import type {
  Environment,
  ExternalSkillInput,
  HarnessId,
  LintSettings,
  SkillSettings,
} from "../../src/core/types.js";
import { git } from "../../src/engine/external/git.js";

export function assertNever(value: never): never {
  throw new TypeError(`Unexpected fixture variant: ${String(value)}`);
}

export function skill(
  name: string,
  body = "Use `Read` to inspect the project.\n",
  fields = "",
): string {
  return `---\nname: ${name}\ndescription: Use when reviewing a project.\n${fields}---\n${body}`;
}

export async function externalFixture() {
  const root = await mkdtemp(join(fileURLToPath(new URL("../", import.meta.url)), ".external-"));
  const repo = join(root, "config");
  const remote = join(root, "remote");
  const env: Environment = {
    ...process.env,
    HOME: join(root, "home"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_MASTER: "1",
  };
  const put = async (path: string, content: string | Buffer) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  };
  await mkdir(remote);
  await mkdir(repo);
  const remoteGit = (args: readonly string[]) => git(args, { env, cwd: remote });
  await remoteGit(["init", "--quiet", "--initial-branch=main"]);
  await put(join(remote, "skills/review/SKILL.md"), skill("review"));
  await put(join(remote, "skills/release/SKILL.md"), skill("release"));
  const commit = async () => {
    await remoteGit(["add", "."]);
    await remoteGit([
      "-c",
      "user.name=Synthetic",
      "-c",
      "user.email=synthetic@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--allow-empty",
      "-m",
      "fixture",
    ]);
    return (await remoteGit(["rev-parse", "HEAD"])).trim();
  };
  const initial = await commit();
  const url = pathToFileURL(remote).href;
  const configure = async (
    external: readonly ExternalSkillInput[],
    options: {
      readonly skills?: Partial<SkillSettings>;
      readonly lint?: LintSettings;
      readonly harnesses?: readonly HarnessId[];
    } = {},
  ) => {
    await put(
      join(repo, "skillerie.yaml"),
      stringify({
        version: 1,
        harnesses: Object.fromEntries(
          (options.harnesses ?? ["opencode"]).map((name) => [
            name,
            { path: join(root, "home", name) },
          ]),
        ),
        paths: { cache: join(root, "cache"), backup: join(root, "backups") },
        skills: { ...options.skills, external },
        ...(options.lint ? { lint: options.lint } : {}),
      }),
    );
  };
  await configure([{ url, path: "skills" }]);
  return {
    root,
    repo,
    remote,
    url,
    initial,
    env,
    put,
    remoteGit,
    commit,
    configure,
    async command(argv: readonly string[], options: { readonly env?: Environment } = {}) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const code = await runCli([...argv, "--repo", repo], {
        env: options.env ?? env,
        stdout: (text) => {
          stdout.push(text);
        },
        stderr: (text) => {
          stderr.push(text);
        },
      });
      return { code, stdout: stdout.join(""), stderr: stderr.join("") };
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
