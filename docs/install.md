# Install, status, and uninstall

skillerie works in two stages. Rendering turns your repository into a generation: a directory tree with one subdirectory per harness. Installing makes each harness home point at that generation. Only `install` and `uninstall` touch harness homes.

## Commands

All commands take `--repo <dir>` (default: the current directory) and the global `--json` flag, which prints one JSON object instead of text.

### validate

```sh
skillerie validate
```

Loads `skillerie.yaml`, discovers sources, evaluates `requires`, runs lint rules, and checks agent restrictions against each enabled harness. Diagnostics go to stderr as `<severity> <file>[:<line>|#<pointer>] <code> <message>`. Exit status is 1 when there is at least one error.

### sync

```sh
skillerie sync [--harness <h>] [--check]
```

Validates, renders every enabled harness, writes a new generation to the cache, and points `current` at it. It doesn't touch harness homes. `--harness` renders one harness. `--check` renders into a temporary directory and compares it with `current` instead, reporting each difference as `sync.drift`; it exits 1 when anything differs.

### install

```sh
skillerie install [--harness <h>] [--check] [--force] [--takeover]
```

Validates, renders, plans, and applies. You don't need to run `sync` first.

<!-- prettier-ignore -->
| Flag | Effect |
|-|-|
| `--harness <h>` | Install one enabled harness. Every enabled harness is still rendered into the new generation so other installed homes keep working. |
| `--check` | Print the plan and exit. Nothing is created or written and no lock is taken. |
| `--force` | Back up and replace managed files you edited, instead of preserving them |
| `--takeover` | Install into a home that another repository's manifest owns |

The plan prints one line per change:

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

Prints `OWNED <home> <repo>` or `UNOWNED <home>` for each enabled harness, followed by any pending changes, user edits, and generation drift. Exit status is 0 only when everything is installed and current.

### uninstall

```sh
skillerie uninstall [--harness <h>]
```

Reads each configured harness's manifest and undoes the install. It doesn't render or read your sources, so it works even after you've deleted skills. A harness with no manifest is skipped without creating anything.

### doctor

```sh
skillerie doctor
```

Reports, for each enabled harness: whether its CLI is on `PATH`, its version against the adapter's supported range, and whether its home and agent directory are writable. It also checks the Node version, every binary named in a `requires.bin`, and skills in `~/.agents/skills` that shadow managed skills. A missing harness CLI is informational. Exit status is 1 only for errors, such as an unwritable home.

### init

```sh
skillerie init [dir] [--harness <h...>] [--force]
```

Creates `skillerie.yaml`, `instructions.md`, `mcp.json`, empty `skills/`, `agents/`, and `rules/` directories, a `.gitignore`, and a `package.json` pinning skillerie to the current minor version. Without `--harness`, it enables the harnesses whose CLIs are on `PATH`. If any of those files already exists, `init` lists them and exits 1 without writing; `--force` replaces only the scaffold files and leaves everything else in the directory alone.

## Generations

Rendered output goes to `<cache>/generations/<hash>/`, where `<hash>` identifies the input snapshot: resolved configuration, hashes of every source file, `requires` results, and the engine version. The same inputs always produce the same generation.

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
| `manifest.json` | Owning repository and config hash, engine version, every managed path with its fingerprint and the content it replaced, every merged block, and directories skillerie created |
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
