#!/usr/bin/env node
import { Command } from "commander";
import { CommanderError, Option } from "commander";
import { existsSync, realpathSync } from "node:fs";
import { basename, resolve, dirname } from "node:path";
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
import type {
  EngineOptions,
  UpdateResult,
  LifecycleResult,
  OutdatedEntry,
  OutdatedResult,
} from "./engine/index.js";
import { externalRepositoryUrl } from "./model/external.js";
import { isHarness } from "./engine/render.js";
import { HARNESS_IDS } from "./engine/types.js";
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

/** Errors and notes in full; warnings grouped to one line per code unless verbose. */
export function formatGroupedDiagnostics(
  diagnostics: readonly Diagnostic[],
  options: {
    readonly color?: boolean;
    readonly verbose?: boolean;
    /** Hide informational notes (doctor's passed checks) unless verbose. */
    readonly hideInfo?: boolean;
  } = {},
): readonly string[] {
  const color = options.color === true;
  let hidden = 0;
  const lines: string[] = [];
  const warnings = new Map<string, { readonly name: string; readonly message: string }[]>();
  for (const diagnostic of diagnostics) {
    if (diagnostic.code === "merge.conflict") continue;
    if (diagnostic.severity === "info" && options.hideInfo && !options.verbose) {
      hidden += 1;
      continue;
    }
    if (diagnostic.severity !== "warn" || options.verbose) {
      lines.push(formatDiagnostic(diagnostic, color));
      continue;
    }
    // A skill is named after its folder rather than its SKILL.md file.
    const name = !diagnostic.file
      ? "skillerie"
      : basename(diagnostic.file) === "SKILL.md"
        ? basename(dirname(diagnostic.file))
        : basename(diagnostic.file).replace(/\.[^.]+$/, "");
    warnings.set(diagnostic.code, [
      ...(warnings.get(diagnostic.code) ?? []),
      { name, message: diagnostic.message },
    ]);
  }
  for (const [code, entries] of warnings) {
    const label = color ? style(SEVERITY_STYLE.warn, "warn") : "warn";
    const names = [...new Set(entries.map((entry) => entry.name))];
    // One source for every warning: its message says more than a repeated file name.
    const what =
      names.length === 1 && entries.length > 1
        ? (entries[0]?.message ?? "").replace(/^\S+:\/\/\S+: /, "")
        : names.join(", ");
    const detail = `${code} (${entries.length}): ${what}`;
    lines.push(`${label} ${color ? style("2", detail) : detail}`);
  }

  const hint =
    warnings.size && hidden
      ? "Add --verbose to see each warning and passed check."
      : warnings.size
        ? "Add --verbose to see each warning."
        : hidden
          ? "Add --verbose to see each passed check."
          : "";
  if (hint) lines.push(color ? style("2", hint) : hint);
  return lines;
}

/** One-line count of diagnostics by severity, for commands that end on diagnostics. */
export function formatTally(diagnostics: readonly Diagnostic[], color = false): string {
  const count = (severity: Diagnostic["severity"]) =>
    diagnostics.filter((item) => item.severity === severity).length;
  const [errors, warnings, notes] = [count("error"), count("warn"), count("info")];
  const text = [
    `${errors} ${errors === 1 ? "error" : "errors"}`,
    `${warnings} ${warnings === 1 ? "warning" : "warnings"}`,
    ...(notes ? [`${notes} passed`] : []),
  ].join(", ");
  return color ? style(errors ? "1;31" : warnings ? "33" : "32", text) : text;
}

/** Human update report: one row per bumped source with the skills that changed. */
export function formatUpdateReport(result: UpdateResult, color = false): string {
  if (result.exitCode !== 0) return "";
  const paint = (code: string, text: string) => (color ? style(code, text) : text);
  const version = (value: string) => (/^[a-f0-9]{40}$/i.test(value) ? value.slice(0, 7) : value);
  const lines: string[] = [];
  if (result.updated.length) {
    const rows = result.updated.map((entry) => [
      sourceName(entry.url),
      `${version(entry.from)} -> ${version(entry.to)}`,
      entry.skills
        .filter((skill) => skill.status !== "unchanged")
        .map((skill) =>
          skill.status === "changed" ? skill.name : `${skill.name} (${skill.status})`,
        )
        .join(", "),
    ]);
    const widths = [0, 1].map((column) => Math.max(...rows.map((row) => row[column]?.length ?? 0)));
    lines.push(paint("1", `Updated ${rows.length} ${rows.length === 1 ? "pin" : "pins"}:`), "");
    for (const [source = "", change = "", skills = ""] of rows)
      lines.push(
        `  ${source.padEnd(widths[0] ?? 0)}  ${paint("2", change.padEnd(widths[1] ?? 0))}  ${skills}`,
      );
  }
  if (result.followed.length) {
    if (lines.length) lines.push("");
    lines.push(
      `${paint("1", "Following a branch:")} ${result.followed.map((entry) => sourceName(entry.url)).join(", ")}`,
    );
  }
  if (lines.length) lines.push("");
  lines.push(
    result.updated.length
      ? `Review the diff of skillerie.yaml, then run ${paint("1", "skillerie install")}.`
      : result.followed.length
        ? `Run ${paint("1", "skillerie install")} to pick up the sources that follow a branch.`
        : paint("32", "No pinned external skill has changes to update."),
  );
  return `${lines.join("\n")}\n`;
}

/** Human install report: one summary row per harness home, details on request. */
export function formatInstallReport(
  result: LifecycleResult,
  options: {
    readonly check?: boolean;
    /** Describe an uninstall: removals and restored entries instead of installs. */
    readonly uninstall?: boolean;
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
    const parts = options.uninstall
      ? (["removed", "restored"] as const).flatMap((label) => {
          // Uninstall moves managed entries to the backup directory and restores what they replaced.
          const count = [...counts]
            .filter(([kind]) => (kind === "BACKUP") === (label === "removed"))
            .reduce((sum, [, value]) => sum + value, 0);
          return count ? [paint(label === "removed" ? "33" : "36", `${count} ${label}`)] : [];
        })
      : [...counts].map(([kind, count]) => {
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
      options.uninstall
        ? paint("1;31", "Some files were edited by you and left alone.")
        : `${paint("1;31", "Some files were edited by you and left alone.")} Use ${paint("1", "--force")} to back them up and replace them.`,
    );
  else if (options.uninstall && result.valid)
    lines.push(
      changed
        ? paint(
            "32",
            `Removed skillerie from ${changed} harness ${changed === 1 ? "home" : "homes"}; replaced files were restored.`,
          )
        : "Nothing was installed from this repository.",
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

/** Human status report: ownership and pending changes per home, then external skills. */
export function formatStatusReport(
  result: LifecycleResult,
  options: { readonly color?: boolean; readonly home?: string; readonly repo?: string } = {},
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
  for (const installation of result.installations) {
    const pending = installation.actions.filter((action) => action.kind !== "SKIP").length;
    let state: string;
    if (!installation.installed) state = paint("2", "not installed");
    else if (installation.owner && options.repo && installation.owner.path !== options.repo)
      state = paint("33", `installed from ${short(installation.owner.path)}`);
    else if (installation.userEdits.length)
      state = paint("1;31", `installed, ${installation.userEdits.length} edited by you`);
    else if (pending)
      state = paint("33", `installed, ${pending} ${pending === 1 ? "change" : "changes"} pending`);
    else state = paint("32", "installed, up to date");
    lines.push(
      `  ${paint("1", installation.harness.padEnd(width))}  ${paint("2", short(installation.home).padEnd(homeWidth))}  ${state}`,
    );
    for (const target of installation.userEdits)
      lines.push(`      ${paint("31", "edited")} ${short(target)}`);
  }
  for (const diagnostic of result.diagnostics)
    if (diagnostic.code === "merge.conflict")
      // Kept verbatim: conflict lines are matched by scripts.
      lines.push(`CONFLICT ${diagnostic.file ?? "config.toml"} ${diagnostic.message}`);
  const external = result.external ?? [];
  if (external.length) {
    const rows = external.map((entry) => [
      sourceName(entry.url),
      entry.ref === undefined || /^[a-f0-9]{40}$/i.test(entry.ref) ? "" : entry.ref,
      entry.sha.slice(0, 7),
      entry.path,
    ]);
    const widths = [0, 1, 2].map((column) =>
      Math.max(...rows.map((row) => row[column]?.length ?? 0)),
    );
    lines.push("", paint("1", "External skills:"));
    for (const [source = "", ref = "", sha = "", path = ""] of rows)
      lines.push(
        `  ${source.padEnd(widths[0] ?? 0)}  ${paint(
          "2",
          [ref.padEnd(widths[1] ?? 0), sha]
            .filter(Boolean)
            .join("  ")
            .padEnd((widths[1] ? (widths[1] ?? 0) + 2 : 0) + (widths[2] ?? 0)),
        )}${path ? `  ${paint("2", path)}` : ""}`.trimEnd(),
      );
  }
  const drift = result.drift?.length ?? 0;
  lines.push("");
  if (drift) lines.push(paint("2", `${drift} generated files differ from a fresh render.`));
  lines.push(
    result.clean
      ? paint("32", "Everything is installed and up to date.")
      : `Run ${paint("1", "skillerie install")} to bring these homes up to date.`,
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
    .option("--verbose", "Show each warning")
    .option("--profile <name>", "Profile to use; defaults to the first one in skillerie.yaml")
    .action(async (_options: unknown, command: Command) => {
      const options = command.optsWithGlobals<{
        readonly repo: string;
        readonly json?: boolean;
        readonly profile?: string;
        readonly verbose?: boolean;
      }>();
      const live =
        !options.json && dependencies.stderr === undefined && process.stderr.isTTY === true;
      const result = await validateRepo(options.repo, {
        ...dependencies,
        ...(live ? { onProgress: (message: string) => stderr(`\r\x1b[2K${message}...`) } : {}),
        ...(options.profile === undefined ? {} : { profile: options.profile }),
      });
      if (live) stderr("\r\x1b[2K");
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
        for (const line of formatGroupedDiagnostics(result.diagnostics, {
          color,
          verbose: options.verbose === true,
        }))
          stderr(`${line}\n`);
        if (result.model && exitCode === 0) {
          const harnesses = HARNESS_IDS.filter(
            (id) => result.snapshot?.config.harnesses[id]?.enabled,
          );
          const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
          stdout(
            `${colorOut ? style("32", "Valid") : "Valid"}${result.profile === undefined ? "" : ` (profile ${result.profile})`}: ${count(result.model.skills.length, "skill")}, ${count(result.model.agents.length, "agent")}, ${count(result.model.rules.length, "rule")} for ${harnesses.join(", ")}.\n`,
          );
        } else stderr(`${formatTally(result.diagnostics, color)}\n`);
      }
    });

  program
    .command("sync")
    .description("Render enabled harnesses into a generation")
    .option("--repo <dir>", "Config repository", process.cwd())
    .option("--profile <name>", "Profile to use; defaults to the first one in skillerie.yaml")
    .option("--check", "Compare generated output without activating it")
    .option("--verbose", "Show each warning and the generation path")
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
        readonly verbose?: boolean;
      }>();
      const live =
        !options.json && dependencies.stderr === undefined && process.stderr.isTTY === true;
      const result = await syncRepo(options.repo, {
        ...dependencies,
        ...(live ? { onProgress: (message: string) => stderr(`\r\x1b[2K${message}...`) } : {}),
        ...(options.profile === undefined ? {} : { profile: options.profile }),
        ...(options.check === undefined ? {} : { check: options.check }),
        ...(options.harness && isHarness(options.harness) ? { harness: options.harness } : {}),
      });
      if (live) stderr("\r\x1b[2K");
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
        const paint = (code: string, text: string) => (colorOut ? style(code, text) : text);
        if (result.profile !== undefined) stdout(`${paint("1", "Profile:")} ${result.profile}\n`);
        // Drift is one error per file; summarize it unless verbose.
        const drift = options.verbose
          ? []
          : result.diagnostics.filter((item) => item.code === "sync.drift");
        for (const line of formatGroupedDiagnostics(
          result.diagnostics.filter((item) => !drift.includes(item)),
          { color, verbose: options.verbose === true },
        ))
          stderr(`${line}\n`);
        if (drift.length)
          stdout(
            `${paint("33", `${drift.length} generated files differ from the active generation.`)} Run ${paint("1", "skillerie sync")} to regenerate.\n`,
          );
        else if (options.check && exitCode === 0)
          stdout(`${paint("32", "The active generation is up to date.")}\n`);
        if (result.generation)
          stdout(
            options.verbose
              ? `Generated ${result.generation.dir}\n`
              : `${paint("32", "Generated")} generation ${basename(result.generation.dir).slice(0, 7)}.\n`,
          );
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
              onSource: ({ phase, index, total, url }) => {
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
    if (name === "uninstall")
      lifecycle.option("--verbose", "List every file the uninstall touches");
    if (name === "status" || name === "doctor") lifecycle.option("--verbose", "Show each warning");
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
        !options.json && dependencies.stderr === undefined && process.stderr.isTTY === true;
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
      else if (name !== "doctor") {
        for (const line of formatGroupedDiagnostics(result.diagnostics, {
          color,
          verbose: options.verbose === true,
        }))
          stderr(`${line}\n`);
        const home = (dependencies.env ?? process.env)["HOME"];
        stdout(
          name === "status"
            ? formatStatusReport(result, {
                color: colorOut,
                repo: resolve(options.repo),
                ...(home ? { home } : {}),
              })
            : formatInstallReport(result, {
                check: options.check === true,
                uninstall: name === "uninstall",
                verbose: options.verbose === true,
                color: colorOut,
                ...(home ? { home } : {}),
              }),
        );
      } else {
        // doctor reports problems, hides passed checks unless verbose, then a one-line tally.
        for (const line of formatGroupedDiagnostics(result.diagnostics, {
          color,
          verbose: options.verbose === true,
          hideInfo: true,
        }))
          stderr(`${line}\n`);
        stderr(`${formatTally(result.diagnostics, color)}\n`);
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
      const live =
        !options.json && dependencies.stderr === undefined && process.stderr.isTTY === true;
      const result = await updateRepo(options.repo, {
        ...dependencies,
        ...(live
          ? {
              onSource: ({
                phase,
                index,
                total,
                url,
              }: {
                readonly phase: "query" | "fetch";
                readonly index: number;
                readonly total: number;
                readonly url: string;
              }) =>
                stderr(
                  `\r\x1b[2K${phase === "query" ? "Checking" : "Fetching"} ${index + 1}/${total} ${sourceName(url)}...`,
                ),
            }
          : {}),
        skills,
        ...(options.profile === undefined ? {} : { profile: options.profile }),
      });
      if (live) stderr("\r\x1b[2K");
      exitCode = result.exitCode;
      if (options.json) stdout(`${JSON.stringify(result)}\n`);
      else {
        stdout(formatUpdateReport(result, colorOut));
        for (const diagnostic of result.diagnostics)
          stderr(`${formatDiagnostic(diagnostic, color)}\n`);
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
      exitCode = await runInit(dir ?? process.cwd(), command, {
        ...dependencies,
        stdout,
        stderr,
        color: colorOut,
      });
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
