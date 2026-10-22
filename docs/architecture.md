# Engine architecture

skillerie separates user-owned source content, pure rendering, and installation.

## Pipeline

1. Load `skillerie.yaml`, parse YAML 1.2 with unique keys, validate its schema,
   apply defaults, and resolve supported string variables.
2. Resolve external skill repositories through system git into atomic,
   content-addressed cache directories. Discover their skills alongside local
   skills, agents, rules, instructions, MCP configuration, templates,
   harness assets, seeds, and helper files from the user's repository, then
   resolve overrides and per-harness applicability.
3. Lint the resolved model, including references to excluded entities and
   restrictions that a selected harness cannot enforce.
4. Capture resolved configuration, source hashes, external commit revisions, requirement decisions, and
   engine version in an immutable input snapshot. Its hash identifies output.
5. Render each enabled adapter using only its resolved context.
6. Stage every rendered file, including configuration, into a generation.
   Atomically activate the stable `current` pointer and retain the prior generation.
7. Execute declarative install actions through the engine's ownership, drift,
   backup, lock, and journal machinery.

Configuration and dialect versions are independent. The engine supports
version 1 of each. Unknown versions must produce diagnostics rather than
silently selecting defaults.

## Module map

- `src/core/types.ts` is the public contract entry point. It re-exports primitives,
  source entities, and resolved configuration from focused type modules.
- `src/config/index.ts` owns configuration loading.
- `src/engine/external/` owns git resolution, checkout publication, offline cache
  fallback, and installed revision reads. Model discovery only reads checkouts.
- `src/model/index.ts` owns discovery and requirement evaluation;
  `src/model/frontmatter.ts` owns YAML frontmatter parsing.
- `src/dialect/index.ts` owns balanced call parsing and shared text conversions.
- `src/lint/index.ts` owns semantic validation of the merged model.
- `src/fs/index.ts` owns generation storage, activation, and freshness comparison.
- `src/adapters/index.ts` registers lazy loaders for the four built-in adapters.
- `src/cli.ts` exposes validate, sync, install, uninstall, status, outdated, doctor, and init.
- `src/version.ts` declares engine, configuration, and dialect versions.

## Adapter contract

An adapter exports a named `adapter` object implementing `Adapter`. It declares
its identifier, supported harness version range, tool map, question limits,
permission enforcement, native agent replacements, and command/rule support.
`defaultPaths(env)` resolves harness homes without writing to them.

`render(ctx)` returns relative generation entries, diagnostics, and JSON metadata.
File entries contain bytes or text; symlink entries contain their target string.
Mode values are POSIX permission bits. Consumers must not mutate borrowed buffers.
`targets(ctx, generationDir)` returns install descriptions, never executes them.
The engine passes the stable `current` directory as `generationDir`, so installed
links continue to resolve after atomic generation changes.

Actions describe links, copies, copy-if-missing seeds, managed blocks, exclusive
trees with preserved entries, and owned JSON array merges. JSON paths are RFC 6901
pointers. Seeds become user-owned; managed foreign-file changes retain preimages.
Optional `check` and `doctor` methods return findings without mutating installations.
Only the engine mutates the filesystem.

Resolved entities retain their origin and final applicable harnesses, including
entities with empty applicability needed for reference diagnostics.
External skills have source `external` and retain URL, ref, commit, and skill path.
Rendered source comments use that origin rather than a cache path. External content
lint is skipped, but required metadata and frontmatter parsing remain errors.
`SourceModel.harnesses` contains effective entity copies with each harness's
overrides applied, so adapters do not need to repeat precedence logic. Requirement
evaluation receives captured environment, platform, harness, and binary probes;
adapters must not reevaluate requirements. MCP extension fields remain parsed
JSON, and null per-harness server overrides mean removal.

Arrays and records in shared contracts are readonly. Expected validation failures
return diagnostics and omit the invalid config or model.
