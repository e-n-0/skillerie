# OMO adapter

`index.ts` exports the `omo` adapter. The engine injects it through its adapter
registry; the adapter only returns generation files, diagnostics, and install
actions. It never installs files itself.

Rendering preserves runtime template sections and merges custom agents into
`"[native]".agents`. Agent replacement names come from the harness configuration.
Source permission restrictions that OMO cannot enforce produce errors, including
strict tool allowlists, read-only access, and shell denial.

The runtime configuration lives in the harness home. Agent content defaults to
`~/.omo/agent` and honors `OMO_CODING_AGENT_DIR` and the resolved `agentDir` option.
Seed actions copy only when missing. Skill filters are owned JSON array merges,
not a generated replacement for the user's settings file.

Headless checks use the template's `$schema` URL, with an in-process schema cache,
a bounded request, and parse-only warnings if unavailable. The CLI's doctor
performs launch preparation, so it is not a read-only validation command.
Absent CLI installations produce an informational diagnostic.

Run focused checks from the package root:

```sh
npx tsc --noEmit
npx eslint src/adapters/omo test/adapters/omo
npx prettier --check src/adapters/omo test/adapters/omo
npx vitest run test/adapters/omo
```

Regenerate the neutral sample repository's golden files with:

```sh
UPDATE_GOLDEN=1 npx vitest run test/adapters/omo/golden.test.ts
```

The golden comparison covers paths, entry kinds, modes, and file bytes after
normalizing temporary repository and home paths. It uses the real engine
pipeline with only this adapter registered.
