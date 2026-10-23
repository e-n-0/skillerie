#!/usr/bin/env node
import { Command } from "commander";
import { CommanderError, Option } from "commander";
import { existsSync, realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Diagnostic } from "./core/types.js";
import {
  hasErrors,
  outdatedRepo,
  runLifecycle,
  syncRepo,
  updateRepo,
  validateRepo,
} from "./engine/index.js";
import { describeChanges } from "./engine/external/changes.js";
import type {
  EngineOptions,
  LifecycleResult,
  OutdatedEntry,
  OutdatedResult,
} from "./engine/index.js";
import { externalRepositoryUrl } from "./model/external.js";
import { isHarness } from "./engine/render.js";
import { ENGINE_VERSION } from "./version.js";
import { InstallError } from "./install/index.js";

export interface CliOptions extends EngineOptions {
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
  /** Colors doctor and outdated output; defaults to whether the real output stream supports colors. */
  readonly color?: boolean;
}

const SEVERITY_STYLE: Record<Diagnostic["severity"], string> = {
  error: "1;31",
  warn: "1;33",
  info: "1;36",
};

function style(code: string, text: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

/** Plain output has one independently located diagnostic per line. */
export function formatDiagnostic(diagnostic: Diagnostic, color = false): string {
  const location =
    diagnostic.line !== undefined
      ? `:${diagnostic.line}`
      : diagnostic.jsonPath !== undefined
        ? `#${diagnostic.jsonPath}`
        : "";
  const where = `${diagnostic.file ?? "skillerie"}${location}`;
  if (!color) return `${diagnostic.severity} ${where} ${diagnostic.code} ${diagnostic.message}`;
  return `${style(SEVERITY_STYLE[diagnostic.severity], diagnostic.severity)} ${style("2", where)} ${style("90", diagnostic.code)} ${diagnostic.message}`;
}

/** Short source name: owner/repo for GitHub, the URL otherwise. */
function sourceName(url: string): string {
  return externalRepositoryUrl(url).replace(/^https:\/\/github\.com\//, "");
}

function versionChange(entry: OutdatedEntry): string {
  return entry.kind === "tag"
    ? `${entry.ref ?? ""} -> ${entry.newerTags.at(-1) ?? entry.ref ?? ""}`
    : `${entry.sha.slice(0, 7)} -> ${entry.latestSha.slice(0, 7)}`;
}

const SHOWN_FILES = 3;
const STATUS_STYLE = { changed: "33", added: "32", removed: "31", moved: "33" } as const;

/** Human outdated report: one row per changed skill, the unchanged skills, then what to run. */
export function formatOutdatedReport(result: OutdatedResult, color = false): string {
  const paint = (code: string, text: string) => (color ? style(code, text) : text);
  const rows: { readonly cells: readonly string[]; readonly status: keyof typeof STATUS_STYLE }[] =
    [];
  const unchanged: string[] = [];
  for (const entry of result.entries) {
    if (!entry.outdated) {
      unchanged.push(...entry.selected);
      continue;
    }
    const source = sourceName(entry.url);
    const version = versionChange(entry);
    if (entry.skills === undefined) {
      rows.push({
        cells: [entry.selected.join(", "), "moved", source, version, "skills not compared"],
        status: "moved",
      });
      continue;
    }
    for (const skill of entry.skills) {
      if (skill.status === "unchanged") {
        unchanged.push(skill.name);
        continue;
      }
      const more = skill.files.length - SHOWN_FILES;
      const files =
        skill.files.slice(0, SHOWN_FILES).join(", ") + (more > 0 ? `, +${more} more` : "");
      rows.push({
        cells: [skill.name, skill.status, source, version, files],
        status: skill.status,
      });
    }
  }
  if (rows.length === 0)
    return result.entries.length === 0
      ? ""
      : `${paint(
          "32",
          result.entries.length === 1
            ? "The external source is up to date."
            : `All ${result.entries.length} external sources are up to date.`,
        )}\n`;
  const widths = [0, 1, 2, 3].map((column) =>
    Math.max(...rows.map((row) => row.cells[column]?.length ?? 0)),
  );
  const lines = [paint("1", "Changed upstream:"), ""];
  for (const { cells, status } of rows) {
    const [name = "", label = "", source = "", version = "", files = ""] = cells;
    lines.push(
      `  ${paint("1", name.padEnd(widths[0] ?? 0))}  ${paint(STATUS_STYLE[status], label.padEnd(widths[1] ?? 0))}  ${source.padEnd(widths[2] ?? 0)}  ${paint("2", version.padEnd(widths[3] ?? 0))}  ${paint("2", files)}`,
    );
  }
  if (unchanged.length)
    lines.push("", `${paint("1", "No changes:")} ${paint("2", unchanged.join(", "))}`);
  const changed = result.entries.filter((entry) => entry.outdated);
  const pinned = changed.filter((entry) => entry.kind === "sha" || entry.kind === "tag").length;
  const floating = changed.length - pinned;
  lines.push("");
  if (pinned)
    lines.push(
      `Run ${paint("1", "skillerie update")} to move ${pinned === 1 ? "this pin" : `these ${pinned} pins`}, then ${paint("1", "skillerie install")}.`,
    );
  if (floating)
    lines.push(
      `Run ${paint("1", "skillerie install")} to pick up ${floating === 1 ? "the source that follows" : `the ${floating} sources that follow`} a branch.`,
    );
  return `${lines.join("\n")}\n`;
}

const ACTION_LABELS = {
  LINK: ["linked", "to link", "32"],
  RELINK: ["relinked", "to relink", "36"],
  MERGE: ["merged", "to merge", "36"],
  SEED: ["seeded", "to seed", "36"],
  BACKUP: ["backed up", "to back up", "33"],
} as const;

/** Errors in full; warnings grouped to one line per code, since validate shows each one. */
export function formatInstallDiagnostics(
  diagnostics: readonly Diagnostic[],
  color = false,
): readonly string[] {
  const lines: string[] = [];
  const warnings = new Map<string, string[]>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.code === "merge.conflict") continue;
    if (diagnostic.severity !== "warn") {
      lines.push(formatDiagnostic(diagnostic, color));
      continue;
    }
    const name = diagnostic.file ? basename(diagnostic.file).replace(/\.[^.]+$/, "") : "skillerie";
    warnings.set(diagnostic.code, [...(warnings.get(diagnostic.code) ?? []), name]);
  }
  for (const [code, names] of warnings) {
    const label = color ? style(SEVERITY_STYLE.warn, "warn") : "warn";
    const detail = `${code} (${names.length}): ${[...new Set(names)].join(", ")}`;
    lines.push(`${label} ${color ? style("2", detail) : detail}`);
  }
  const hint = "Run skillerie validate to see each warning.";
  if (warnings.size) lines.push(color ? style("2", hint) : hint);
  return lines;
}

/** Human install report: one summary row per harness home, details on request. */
export function formatInstallReport(
  result: LifecycleResult,
  options: {
    readonly check?: boolean;
    readonly verbose?: boolean;
    readonly color?: boolean;
    readonly home?: string;
  } = {},
): string {
  const paint = (code: string, text: string) => (options.color ? style(code, text) : text);
  const short = (path: string) =>
    options.home && (path === options.home || path.startsWith(`${options.home}/`))
      ? `~${path.slice(options.home.length)}`
      : path;
  const lines: string[] = [];
  if (result.profile !== undefined) lines.push(`${paint("1", "Profile:")} ${result.profile}`, "");
  const width = Math.max(0, ...result.installations.map((item) => item.harness.length));
  const homeWidth = Math.max(0, ...result.installations.map((item) => short(item.home).length));
  let changed = 0;
  for (const installation of result.installations) {
    const counts = new Map<keyof typeof ACTION_LABELS, number>();
    for (const action of installation.actions)
      if (action.kind !== "SKIP") counts.set(action.kind, (counts.get(action.kind) ?? 0) + 1);
    const parts = [...counts].map(([kind, count]) => {
      const [done, planned, code] = ACTION_LABELS[kind];
      return paint(code, `${count} ${options.check ? planned : done}`);
    });
    if (installation.userEdits.length)
      parts.push(paint("1;31", `${installation.userEdits.length} edited by you`));
    if (parts.length) changed += 1;
    lines.push(
      `  ${paint("1", installation.harness.padEnd(width))}  ${paint("2", short(installation.home).padEnd(homeWidth))}  ${parts.length ? parts.join(", ") : paint("32", "up to date")}`,
    );
    if (options.verbose)
      for (const action of installation.actions)
        if (action.kind !== "SKIP")
          lines.push(`      ${paint("2", action.kind.padEnd(6))} ${short(action.target)}`);
    for (const target of installation.userEdits)
      lines.push(`      ${paint("31", "edited")} ${short(target)}`);
  }
  for (const diagnostic of result.diagnostics)
    if (diagnostic.code === "merge.conflict")
      // Kept verbatim: conflict lines are matched by scripts.
      lines.push(`CONFLICT ${diagnostic.file ?? "config.toml"} ${diagnostic.message}`);
  const drift = result.drift?.length ?? 0;
  const edited = result.installations.some((item) => item.userEdits.length);
  const total = result.installations.length;
  lines.push("");
  if (options.check) {
    if (drift)
      lines.push(paint("2", `${drift} generated files differ from the active generation.`));
    lines.push(
      changed || drift
        ? `Run ${paint("1", "skillerie install")} to apply these changes${options.verbose ? "" : " (--verbose lists every file)"}.`
        : paint("32", "Everything is installed and up to date."),
    );
  } else if (edited)
    lines.push(
      `${paint("1;31", "Some files were edited by you and left alone.")} Use ${paint("1", "--force")} to back them up and replace them.`,
    );
  else if (result.valid)
    lines.push(
      paint(
        "32",
        changed
          ? `Installed into ${changed} of ${total} harness homes.`
          : "Everything was already up to date.",
      ),
    );
  return `${lines.join("\n")}\n`;
}

/** Injectable engine dependencies exercise the same command path without global mocks. */
export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: CliOptions = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = dependencies.stderr ?? ((text: string) => process.stderr.write(text));
  const color =
    dependencies.color ??
    (dependencies.stderr === undefined &&
      process.stderr.isTTY === true &&
      process.stderr.hasColors());
  const colorOut =
    dependencies.color ??
    (dependencies.stdout === undefined &&
      process.stdout.isTTY === true &&
      process.stdout.hasColors());
  let exitCode = 0;
  const program = new Command()
    .name("skillerie")
    .description("Keep one coding-agent setup in sync across OpenCode, Codex, OMO and Pi.")
    .version(ENGINE_VERSION)
    .option("--json", "Print machine-readable output")
    .exitOverride()
    .configureOutput({ writeOut: stdout, writeErr: () => undefined });

  program
    .command("validate")
    .description("Validate configuration and source content")
    .option("--repo <dir>", "Config repository", process.cwd())
    .option("--profile <name>", "Profile to use; defaults to the first one in skillerie.yaml")
    .action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<{
        readonly repo: string;
        readonly json?: boolean;
        readonly profile?: string;
      }>();
      const result = await validateRepo(options.repo, {
        ...dependencies,
        ...(options.profile === undefined ? {} : { profile: options.profile }),
      });
      exitCode = hasErrors(result.diagnostics) ? 1 : 0;
      if (options.json) {
        stdout(
          `${JSON.stringify({
            valid: exitCode === 0,
            diagnostics: result.diagnostics,
            ...(result.profile === undefined ? {} : { profile: result.profile }),
          })}\n`,
        );
      } else {
        for (const diagnostic of result.diagnostics) stderr(`${formatDiagnostic(diagnostic)}\n`);
      }
    });

  program
    .command("sync")
    .description("Render enabled harnesses into a generation")
    .option("--repo <dir>", "Config repository", process.cwd())
    .option("--profile <name>", "Profile to use; defaults to the first one in skillerie.yaml")
    .option("--check", "Compare generated output without activating it")
    .addOption(
      new Option("--harness <h>", "Select one enabled harness").choices([
        "opencode",
        "codex",
        "omo",
        "pi",
      ]),
    )
    .action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<{
        readonly repo: string;
        readonly json?: boolean;
        readonly profile?: string;
        readonly check?: boolean;
        readonly harness?: string;
      }>();
      const result = await syncRepo(options.repo, {
        ...dependencies,
        ...(options.profile === undefined ? {} : { profile: options.profile }),
        ...(options.check === undefined ? {} : { check: options.check }),
        ...(options.harness && isHarness(options.harness) ? { harness: options.harness } : {}),
      });
      exitCode = hasErrors(result.diagnostics) || result.drift.length > 0 ? 1 : 0;
      if (options.json) {
        stdout(
          `${JSON.stringify({
            valid: exitCode === 0,
            diagnostics: result.diagnostics,
            drift: result.drift,
            ...(result.profile === undefined ? {} : { profile: result.profile }),
            ...(result.generation ? { generation: result.generation } : {}),
          })}\n`,
        );
      } else {
        if (result.profile !== undefined) stdout(`PROFILE ${result.profile}\n`);
        for (const diagnostic of result.diagnostics) stderr(`${formatDiagnostic(diagnostic)}\n`);
        if (result.generation) stdout(`Generated ${result.generation.dir}\n`);
      }
    });

  program
    .command("outdated")
    .description("Compare external skills with their upstream repositories")
    .option("--repo <dir>", "Config repository", process.cwd())
    .option("--profile <name>", "Profile to use; defaults to the first one in skillerie.yaml")
    .action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<{
        readonly repo: string;
        readonly json?: boolean;
        readonly profile?: string;
      }>();
      // A live status line on a terminal; fetching newer commits can take a while.
      const live =
        !options.json && dependencies.stderr === undefined && process.stderr.isTTY === true;
      const result = await outdatedRepo(options.repo, {
        ...dependencies,
        ...(options.profile === undefined ? {} : { profile: options.profile }),
        ...(live
          ? {
              onProgress: ({ phase, index, total, url }) => {
                const verb = phase === "query" ? "Checking" : "Fetching";
                stderr(`\r\x1b[2K${verb} ${index + 1}/${total} ${sourceName(url)}...`);
              },
            }
          : {}),
      });
      if (live) stderr("\r\x1b[2K");
      exitCode = result.exitCode;
      if (options.json) stdout(`${JSON.stringify(result)}\n`);
      else {
        stdout(formatOutdatedReport(result, colorOut));
        for (const diagnostic of result.diagnostics)
          stderr(`${formatDiagnostic(diagnostic, color)}\n`);
      }
    });

  for (const [name, description] of [
    ["install", "Render your config and install it into the harness homes"],
    ["uninstall", "Remove managed installations and restore merged content"],
    ["status", "Report installation ownership and drift"],
    ["doctor", "Check harness versions, rendered configs and required tools"],
  ] as const) {
    const lifecycle = program
      .command(name)
      .description(description)
      .option("--repo <dir>", "Config repository", process.cwd())
      .option("--profile <name>", "Profile to use; defaults to the first one in skillerie.yaml");
    if (name === "install" || name === "uninstall")
      lifecycle.addOption(
        new Option("--harness <h>", "Select one enabled harness").choices([
          "opencode",
          "codex",
          "omo",
          "pi",
        ]),
      );
    if (name === "install")
      lifecycle
        .option("--verbose", "List every file the install touches")
        .option("--check", "Print the install plan without writing")
        .option("--force", "Back up and replace user-edited managed paths")
        .option("--takeover", "Replace another repository's installation");
    lifecycle.action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<{
        readonly repo: string;
        readonly json?: boolean;
        readonly profile?: string;
        readonly harness?: string;
        readonly check?: boolean;
        readonly force?: boolean;
        readonly takeover?: boolean;
        readonly verbose?: boolean;
      }>();
      // A live status line on a terminal; resolving and rendering can take a while.
      const live =
        name === "install" &&
        !options.json &&
        dependencies.stderr === undefined &&
        process.stderr.isTTY === true;
      const result = await runLifecycle(options.repo, {
        ...dependencies,
        command: name,
        ...(live ? { onProgress: (message: string) => stderr(`\r\x1b[2K${message}...`) } : {}),
        ...(options.profile === undefined ? {} : { profile: options.profile }),
        ...(options.harness && isHarness(options.harness) ? { harness: options.harness } : {}),
        ...(options.check === undefined ? {} : { check: options.check }),
        ...(options.force === undefined ? {} : { force: options.force }),
        ...(options.takeover === undefined ? {} : { takeover: options.takeover }),
      });
      if (live) stderr("\r\x1b[2K");
      exitCode = result.valid ? 0 : 1;
      if (options.json) stdout(`${JSON.stringify(result)}\n`);
      else if (name === "install") {
        for (const line of formatInstallDiagnostics(result.diagnostics, color)) stderr(`${line}\n`);
        const home = (dependencies.env ?? process.env)["HOME"];
        stdout(
          formatInstallReport(result, {
            check: options.check === true,
            verbose: options.verbose === true,
            color: colorOut,
            ...(home ? { home } : {}),
          }),
        );
      } else {
        if (name === "status" && result.profile !== undefined)
          stdout(`PROFILE ${result.profile}\n`);
        for (const diagnostic of result.diagnostics) {
          if (diagnostic.code === "merge.conflict")
            stdout(`CONFLICT ${diagnostic.file ?? "config.toml"} ${diagnostic.message}\n`);
          else stderr(`${formatDiagnostic(diagnostic, color && name === "doctor")}\n`);
        }
        for (const installation of result.installations) {
          if (name === "status")
            stdout(
              `${installation.installed ? "OWNED" : "UNOWNED"} ${installation.home}${installation.owner ? ` ${installation.owner.path}` : ""}\n`,
            );
          if (!installation.actions.length) stdout(`SKIP ${installation.home}\n`);
          for (const action of installation.actions) stdout(`${action.kind} ${action.target}\n`);
          for (const target of installation.userEdits) stdout(`USER-EDIT ${target}\n`);
        }
        for (const difference of result.drift ?? [])
          stdout(`DRIFT ${difference.reason} ${difference.relPath}\n`);
        for (const entry of result.external ?? [])
          stdout(
            `EXTERNAL ${entry.url} ${entry.ref ?? "latest"} ${entry.sha.slice(0, 8)}${entry.path ? ` ${entry.path}` : ""}\n`,
          );
      }
    });
  }

  program
    .command("update [skills...]")
    .description("Bump pinned external skills whose skills changed upstream")
    .option("--repo <dir>", "Config repository", process.cwd())
    .option("--profile <name>", "Profile to use; defaults to the first one in skillerie.yaml")
    .action(async (skills: string[], _options: unknown, command: Command) => {
      const options = command.optsWithGlobals<{
        readonly repo: string;
        readonly json?: boolean;
        readonly profile?: string;
      }>();
      const result = await updateRepo(options.repo, {
        ...dependencies,
        skills,
        ...(options.profile === undefined ? {} : { profile: options.profile }),
      });
      exitCode = result.exitCode;
      if (options.json) stdout(`${JSON.stringify(result)}\n`);
      else {
        for (const entry of result.updated)
          stdout(
            `UPDATED ${entry.url} ${entry.from.slice(0, 12)} -> ${entry.to.slice(0, 12)}; changed: ${describeChanges(entry.skills)}\n`,
          );
        for (const entry of result.followed) stdout(`FOLLOWS ${entry.url} ${entry.message}\n`);
        for (const diagnostic of result.diagnostics)
          stderr(`${formatDiagnostic(diagnostic, color)}\n`);
        if (result.exitCode === 0)
          stdout(
            result.updated.length
              ? "Updated skillerie.yaml; review the diff, then run skillerie install.\n"
              : "No pinned external skill has changes to update.\n",
          );
      }
    });

  program
    .command("init [dir]")
    .description("Create a configuration repository")
    .option("--force", "Replace existing scaffold files")
    .addOption(
      new Option("--harness <h...>", "Enable these harnesses instead of detecting CLIs").choices([
        "opencode",
        "codex",
        "omo",
        "pi",
      ]),
    )
    .action(async (dir: string | undefined, _options: unknown, command: Command) => {
      const { runInit } = await import("./init/index.js");
      exitCode = await runInit(dir ?? process.cwd(), command, { ...dependencies, stdout, stderr });
    });

  try {
    await program.parseAsync([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0;
    if (!(error instanceof Error)) throw error;
    const diagnostic: Diagnostic = {
      severity: "error",
      code:
        error instanceof CommanderError
          ? "cli.arguments"
          : error instanceof InstallError
            ? error.code
            : "cli.failure",
      message: error.message,
      file:
        error instanceof InstallError && error.file
          ? error.file
          : resolve(process.cwd(), "skillerie.yaml"),
      ...(error instanceof InstallError && error.file ? {} : { jsonPath: "" }),
    };
    if (argv.includes("--json"))
      stdout(`${JSON.stringify({ valid: false, diagnostics: [diagnostic] })}\n`);
    else stderr(`${formatDiagnostic(diagnostic)}\n`);
    return program.args[0] === "outdated" ? 2 : 1;
  }
  return exitCode;
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await runCli();
}
