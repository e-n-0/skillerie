# Install, status, and uninstall

skillerie works in two stages. Rendering turns your repository into a generation: a directory tree with one subdirectory per harness. Installing makes each harness home point at that generation. Only `install` and `uninstall` touch harness homes.

## Commands

All commands take `--repo <dir>` (default: the current directory) and the global `--json` flag, which prints one JSON object instead of text.

### Profiles

When `skillerie.yaml` defines [profiles](config.md#profiles), `validate`, `sync`, `outdated`, `install`, `uninstall`, `status`, and `doctor` accept `--profile <name>`. Without it, the first profile in the file is used. An unknown name fails with `config.profile.unknown` and lists the profiles you can pick.

When a profile is applied, `install`, `uninstall`, `status` and `sync` start with `Profile: <name>`, and the JSON output of every command except `outdated` has a `profile` field. Neither appears for a configuration without profiles.

### validate

```sh
skillerie validate [--verbose]
```

Loads `skillerie.yaml`, discovers sources, evaluates `requires`, runs lint rules, and checks agent restrictions against each enabled harness. Diagnostics go to stderr as `<severity> <file>[:<line>|#<pointer>] <code> <message>`. Errors are always printed in full; warnings are grouped to one line per code, listing the files they come from, unless you pass `--verbose`. A valid configuration ends with a summary such as `Valid: 14 skills, 9 agents, 9 rules for opencode, codex.`; otherwise a count of errors and warnings follows. Exit status is 1 when there is at least one error.

The other commands group warnings the same way, and `--verbose` shows each one.

For external skills, diagnostic file locations use `<url>@<short-sha>/<path inside repository>` rather than the cache path. The same origin locations appear in JSON diagnostics and in the other commands.

### sync

```sh
skillerie sync [--harness <h>] [--check] [--verbose]
```

Validates, renders every enabled harness, writes a new generation to the cache, and points `current` at it, then prints `Generated generation <short-hash>.` (`--verbose` prints the full path). It doesn't touch harness homes. `--harness` renders one harness. `--check` renders into a temporary directory and compares it with `current` instead; it exits 1 when anything differs and prints how many generated files differ. `--verbose` lists each difference as a `sync.drift` error.

### install

```sh
skillerie install [--harness <h>] [--profile <name>] [--check] [--verbose] [--force] [--takeover]
```

Validates, renders, plans, and applies. You don't need to run `sync` first.

<!-- prettier-ignore -->
| Flag | Effect |
|-|-|
| `--harness <h>` | Install one enabled harness. Every enabled harness is still rendered into the new generation so other installed homes keep working. |
| `--profile <name>` | Install this [profile](config.md#profiles) instead of the first one. The manifest records it. |
| `--check` | Print the plan and exit. No harness home is changed and no lock is taken; external resolution may populate its cache. |
| `--verbose` | List every file under its harness, not just the counts |
| `--force` | Back up and replace managed files you edited, instead of preserving them |
| `--takeover` | Install into a home that another repository's manifest owns |

The output has one row per harness home, with counts such as `12 linked, 1 backed up`, or `up to date`; `--check` says `to link` instead. Files you edited are always listed under their harness, and a last line says what happened or what to run next. With `--check`, differences between the active generation and a fresh render are summarized as a count. On a terminal, a status line on stderr shows each phase while it runs (loading, rendering, planning, installing). Paths under your home directory are shortened to `~`.

With `--verbose`, each change is listed under its harness:

<!-- prettier-ignore -->
| Line | Meaning |
|-|-|
| `LINK <path>` | Create a symlink into the generation |
| `RELINK <path>` | Replace an existing symlink |
| `MERGE <path>` | Write managed content into a file you own |
| `SEED <path>` | Copy a seed file that doesn't exist yet |
| `BACKUP <path>` | Move the existing entry to the backup directory first |
| `SKIP <path>` | Nothing to write here (a directory, or a preserved user edit) |
| `USER-EDIT <path>` | A managed file you changed; left alone |
| `DRIFT <reason> <path>` | The active generation differs from a fresh render (`--check` only) |

`install --check` exits 0 only when the homes are already up to date, the active generation matches a fresh render, and nothing is preserved as a user edit. Otherwise it exits 1, which makes it usable as a CI or pre-commit gate.

`install` exits 1 when there are errors or when any managed file was preserved as a user edit. Post-install hooks run only after a clean install.

### status

```sh
skillerie status
```

Prints one row per enabled harness home: `not installed`, `installed from <repo>` when another repository owns it, `installed, N changes pending`, `installed, N edited by you` (each edited file is listed), or `installed, up to date`. A count of generated files that differ from a fresh render and a line saying what to run follow. Exit status is 0 only when everything is installed and current.

If a home was installed with a different profile than the one `status` uses, it warns with `install.profile.mismatch`, for example `Installed with profile "work"; pass --profile work to compare against it.`

An `External skills:` section lists each external entry as `owner/repo`, its tag or branch (pinned commits aren't repeated), short commit and path, using the active generation's revisions when available. The JSON result includes the full revisions under `external`.

### outdated

```sh
skillerie outdated [--repo <dir>] [--json]
```

Queries upstream for every `skills.external` entry and compares it with the active generation's recorded commit, or its install manifest. With no installed revision, the current remote resolution is the baseline.

- Tags report newer semantic-version tags, for example `v1.2.0 -> v1.4.0 available`. Non-semver tags are ignored.
- Branches and the default branch report `up to date` or `upstream moved <old>..<new>; run install`.
- Full SHA pins report the default branch head when it differs.

When upstream has moved, `outdated` fetches the newer commit into the external cache, the same way `install` does, and compares the entry's selected skills file by file. The line then ends with what changed, for example `changed: review (SKILL.md, scripts/check.sh), audit (added)`, or with `no changes to review, release` when upstream moved without touching them. An entry only counts as behind when a selected skill changed. If the newer commit can't be fetched, a `external.changes` warning explains why and the entry falls back to the commit comparison.

Human output is a table with one row per changed skill: its name, whether it was changed, added or removed, the source, the version change, and the first changed files. A `No changes:` line lists the selected skills that didn't change, and a last line says what to run: `skillerie update` for pinned sources, `skillerie install` for sources that follow a branch. When every source is current, it prints a single line. On a terminal, a status line on stderr shows which source is being checked or fetched. JSON includes `entries`, `diagnostics`, and `exitCode`; each entry has its `index` in `skills.external`, ref, baseline `sha`, `latestSha`, `newerTags`, `status`, `outdated` boolean, and message, plus `skills` (each with `name`, `status` of `changed`, `unchanged`, `added` or `removed`, and the changed `files`) when upstream moved. Exit status is 0 when current, 1 when any selected skill changed upstream, and 2 on errors. The command adds fetched commits to the external cache but does not update the cache index or active generation.

### update

```sh
skillerie update [skill...] [--repo <dir>] [--json]
```

Runs the same comparison as `outdated`, then bumps every pinned external entry whose selected skills changed: a full SHA pin moves to the default branch head, and a tag pin moves to the newest semantic-version tag. Name skills to limit the update to the entries that contain them.

Only the pinned value changes in `skillerie.yaml`: the `ref`, or the commit inside a `/tree/<ref>/...` URL. Comments, quoting and the rest of the file stay as they are. Entries that follow a branch or the default branch aren't rewritten; they're listed as `FOLLOWS`, because `install` already picks up their new commit.

Human output lists each bumped source with its old and new commit or tag and the skills that changed, then the sources that follow a branch. JSON has `updated`, `followed`, `diagnostics`, and `exitCode`. Review the diff, then run `skillerie install` to apply it. Exit status is 0 on success and 2 on errors.

### uninstall

```sh
skillerie uninstall [--harness <h>] [--verbose]
```

Reads each configured harness's manifest and undoes the install. It prints one row per harness home with how many entries were removed and how many replaced files were restored; `--verbose` lists each one. It doesn't render or read your sources, so it works even after you've deleted skills. A harness with no manifest is skipped without creating anything.

### doctor

```sh
skillerie doctor
```

Reports, for each enabled harness: whether its CLI is on `PATH`, its version against the adapter's supported range, whether its home and agent directory are writable, and, when the CLI is installed, whether the harness accepts the rendered configuration (a headless check through the harness CLI that writes nothing to your homes). It also checks the Node version, every binary named in a `requires.bin`, and skills in `~/.agents/skills` that shadow managed skills. A missing harness CLI is informational. Passed checks are hidden and warnings are grouped; `--verbose` shows each one. The last line counts errors, warnings and passed checks. Exit status is 1 only for errors, such as an unwritable home.

External inspection stays offline: it reads cached skills and reports each entry's installed ref and short SHA, with a hint to run `skillerie outdated` for an upstream check.

### init

```sh
skillerie init [dir] [--harness <h...>] [--force]
```

Creates `skillerie.yaml`, `instructions.md`, `mcp.json`, empty `skills/`, `agents/`, and `rules/` directories, a `.gitignore`, and a `package.json` pinning skillerie to the current minor version. Without `--harness`, it enables the harnesses whose CLIs are on `PATH`. If any of those files already exists, `init` lists them and exits 1 without writing; `--force` replaces only the scaffold files and leaves everything else in the directory alone.

## Generations

Rendered output goes to `<cache>/generations/<hash>/`, where `<hash>` identifies the input snapshot: resolved configuration, hashes of every source file, resolved external commits, `requires` results, and the engine version. The same inputs always produce the same generation. Generations with external skills retain their revisions in `.skillerie-external.json`.

`<cache>/current` is a symlink to the active generation. It is replaced atomically, and installed links go through it, so switching generations never leaves a half-updated home. skillerie keeps the current and the previous generation and deletes older ones.

The cache defaults to `~/.cache/skillerie/<repo-hash>`. With `generated.commit: true` it is `generated/` inside your repository.

## How files are installed

Each adapter describes what goes where; the engine performs every write. There are four kinds of target:

- Links. A single file such as `AGENTS.md` becomes a symlink into the generation.
- Exclusive trees. A directory such as `skills/` becomes a real directory whose entries are symlinks into the generation. Entries skillerie doesn't render are backed up and removed, except for names the adapter preserves (Codex keeps `skills/.system`).
- Managed blocks. Content goes between marker comments inside a file you own, such as Codex's `config.toml`. Text outside the markers is never changed.
- JSON array merges. Values are appended to an array in a file you own, such as OMO's `settings.json`, and only those values are removed later.

Seeds are copied when the target is missing and then belong to you; skillerie never updates or removes them.

## Ownership and the manifest

Every harness home gets a `.skillerie/` directory:

<!-- prettier-ignore -->
| File | Purpose |
|-|-|
| `manifest.json` | Owning repository and config hash, engine version, resolved external revisions, every managed path with its fingerprint and the content it replaced, every merged block, and directories skillerie created |
| `journal.json` | Present only while a transaction is in progress |
| `lock` | Present only while an install or uninstall runs |

If the manifest names a different repository, `install` refuses with `install.owner` unless you pass `--takeover`.

## User edits

On every run skillerie compares each managed path with the fingerprint in the manifest. If you replaced a link, edited a file, or changed a managed block, that path is reported as `USER-EDIT` and left alone by both `install` and `uninstall`. `install --force` backs up your version and puts the managed one back.

## Backups

Before replacing or removing any existing file, link, or directory, skillerie moves it to the backup directory, keeping its path relative to your home:

```text
~/.Trash/skillerie/2026-01-15T10-04-12-345Z-<id>-0/.config/opencode/opencode.jsonc
```

Backups are never deleted by skillerie. Set the location with `paths.backup` or `SKILLERIE_BACKUP_DIR`.

## Locking and recovery

An install or uninstall creates `.skillerie/lock` with its process ID; a second process waits up to 30 seconds, and a lock left by a dead process is reclaimed. All planned changes are written to `.skillerie/journal.json` before the first one is applied. If a run is interrupted, the next run replays the remaining steps before doing anything else. If recovery finds that a target changed in the meantime and a backup for it already exists, it stops with `journal.conflict` and leaves both in place.

Install targets must be real paths. skillerie refuses to write through a symlinked parent directory inside your home, and refuses targets inside its own `.skillerie/` directory or the backup directory.

## Uninstall in detail

For each managed path, in reverse order of installation:

- links and copied files are replaced with whatever was there before the first install, or removed if nothing was;
- exclusive trees are emptied of managed entries, and directories skillerie created are removed if they end up empty;
- managed blocks and array values are removed from your files, and a file skillerie created is deleted if nothing else is left in it;
- user-edited paths are preserved and reported;
- seeds and backups stay.

The manifest is deleted once nothing is left to manage.
