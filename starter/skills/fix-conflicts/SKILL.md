---
name: fix-conflicts
description: >
  Use when git reports merge conflicts, rebase conflicts, cherry-pick conflicts,
  or revert conflicts, or when the user asks to resolve conflicts.
  Triggers: "fix conflicts", "resolve conflicts", "merge conflicts", "rebase conflicts",
  "fix merge", "resolve merge", "help with conflicts", "conflict markers".
argument-hint: "[optional: specific file to resolve]"
user-invocable: true
allowed-tools: Bash(git add:*), Bash(git rm:*), Bash(git show:*), Bash(git blame:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git rev-parse:*), Bash(git merge-base:*), Bash(cat:*), Bash(gh:*), Read, Edit, Grep, Glob, AskUserQuestion
---

# Fix Conflicts

Announce: "I'm using the fix-conflicts skill to resolve merge conflicts."

## Step 1: Detect Conflict State

Run these in parallel:

```bash
git rev-parse --git-dir
git status --porcelain=v1
```

Conflicted paths carry a two-letter status: `UU` (both modified), `AA` (both added), `UD` or `DU` (modified on one side, deleted on the other), `AU` or `UA` (added on one side only). Name the operation from marker files under the git directory: `MERGE_HEAD` means merge, `rebase-merge/` or `rebase-apply/` means rebase, `CHERRY_PICK_HEAD` means cherry-pick, `REVERT_HEAD` means revert.

**If no operation is in progress and no path has a conflict status:** inform the user there are no conflicts to resolve and stop.

**If `$ARGUMENTS` specifies a file:** limit resolution scope to that file only (verify it appears in the conflicted list).

## Step 2: Read Conflicted Files

Read every conflicted file listed in Step 1. For large files (>500 lines), focus on sections containing conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).

Then name the two sides and gather history for each:

| Operation   | Ours (current side)                            | Theirs (incoming side)                 |
| ----------- | ---------------------------------------------- | -------------------------------------- |
| merge       | `HEAD`                                         | `MERGE_HEAD`                           |
| cherry-pick | `HEAD`                                         | `CHERRY_PICK_HEAD`                     |
| revert      | `HEAD`                                         | `REVERT_HEAD`                          |
| rebase      | `HEAD` (upstream plus commits already applied) | the commit being replayed (see Step 5) |

```bash
theirs=MERGE_HEAD  # substitute the incoming ref from the table above
base=$(git merge-base HEAD "$theirs")

# Ours: commits on the current side that touched the conflicted file
git log --oneline "$base..HEAD" -- <conflicted-file>

# Theirs: commits on the incoming side that touched it
git log --oneline "$base..$theirs" -- <conflicted-file>
```

For each commit listed, inspect its actual diff to understand intent:

```bash
# Show the full diff for a specific commit touching the conflicted file
git show <commit-sha> -- <conflicted-file>
```

Pay attention to:

- **Additions**: new code, new functions, new parameters
- **Removals**: deleted code, removed functions, removed parameters —
  note whether the commit message explains the removal (refactor, deprecation, cleanup)
  or whether the removal looks incidental to a larger change
- **Modifications**: changed logic, renamed symbols, updated signatures

For each conflict, determine:

| Question                                   | How to answer                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| What did the local side change?            | `git show` each local commit touching the file; inspect code between `<<<<<<< HEAD` and `=======`               |
| What did the remote side change?           | `git show` each remote commit touching the file; inspect code between `=======` and `>>>>>>>`                   |
| Did either side intentionally remove code? | Check if the removal was in a dedicated commit (refactor/cleanup/deprecation) vs. incidental to a larger change |
| Are changes independent?                   | Different logical concerns = keep both                                                                          |
| Are changes contradictory?                 | Same logic changed differently = need judgment                                                                  |

**Find the primary sources behind each side.**
Commit messages and diffs tell you what changed; the PRs and issues behind them tell you why.
For each side's commits, look up the originating discussion:

```bash
# PR associated with a commit
gh pr list --search "<commit-sha>" --state all --json number,title,body
```

Read the PR description and any linked issues before resolving.
Understand deeply why each change was made and what the original intent was —
resolution quality is bounded by how well you understand both intents.

## Step 3: Resolve by Conflict Type

**Always resolve; never `--abort`.**
Abandoning the operation throws away the context you've built and leaves the problem for next time.
Never run `git merge --abort`, `git rebase --abort`, `git cherry-pick --abort`, or `git revert --abort`
on your own initiative — if a conflict is genuinely undecidable, use the "When uncertain" interaction below.

### Rebase conflict orientation (CRITICAL)

During `git rebase`, ours/theirs are **reversed** from merge:

| Side                           | Merge           | Rebase                    |
| ------------------------------ | --------------- | ------------------------- |
| `<<<<<<< HEAD` (ours)          | Your branch     | **Upstream** (e.g., main) |
| `=======` → `>>>>>>>` (theirs) | Incoming branch | **Your feature branch**   |

The code between `=======` and `>>>>>>>` is YOUR feature branch work.
**Never discard it without explicit user confirmation** — doing so silently loses changes you wrote.

Resolution posture during rebase:

1. Treat the theirs section as the change you must land; treat the ours section as context to integrate around it.
2. If both sides modified the same lines with incompatible intent, ask via an `<interaction>AskUserQuestion</interaction>` block (see "When uncertain" below).
3. "Upstream looks newer/cleaner" is NOT sufficient justification to drop theirs.

### Standard conflicts (UU — both modified, AA — both added)

1. Understand intent of both sides from history and surrounding code.
2. Choose resolution strategy:

| Situation                                                      | Strategy                                                                                                                                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Changes are independent (different functions, different lines) | Merge both — keep all changes                                                                                                                                                    |
| Changes overlap but complement each other                      | Combine intelligently — integrate both intents                                                                                                                                   |
| Changes contradict each other                                  | Ask via an `<interaction>AskUserQuestion</interaction>` block (see "When uncertain" below)                                                                                       |
| One side is strictly newer/better                              | `git show` both sides' commits — only keep one side if the other's changes are already included or purely cosmetic. During rebase, verify "better" is not just upstream recency. |

3. Remove ALL conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
4. Verify the result is syntactically correct.

### Intent preservation rules (apply to ALL conflict types)

Before writing the resolved version of any conflict, complete this checklist:

1. **List both sides' meaningful changes.**
   For each side, write a one-line summary of what it intended (from Step 2's `git show` analysis).
2. **Verify no silent drops.**
   If you are keeping only one side's text, confirm the other side made no substantive changes
   (logic, behavior, API) in that region. Formatting-only or whitespace-only differences are safe to drop.
3. **Respect intentional removals.**
   If one side removed code that the other side still has (or modified):
   - `git show` the commit that performed the removal.
   - If the commit message or diff shows a deliberate action (refactor, deprecation, dead-code cleanup,
     feature removal), **do not re-add the removed code** — the removal wins.
   - If the removal looks incidental (part of a large unrelated change, no mention in the commit message),
     use the "When uncertain" interaction below to clarify whether the removal was intentional.
4. **Never re-add intentionally deleted code.**
   Code that was removed in a dedicated cleanup or refactor commit must stay removed,
   even if the other side's conflict block still contains it.
5. **Never invent new behaviour.**
   Resolution combines existing intents; it does not create them.
   If neither side's code does what the situation needs, the conflict is telling you something —
   use the "When uncertain" interaction below instead of writing new logic.

| Rationalization                                     | Reality                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| "I'll keep both sides to be safe"                   | Re-adding intentionally deleted code is not safe — it reverses a deliberate decision |
| "The other side still has it, so it must be needed" | The other side's branch may predate the removal                                      |
| "One side is newer so I'll take that whole block"   | The older side may contain additions the newer side never saw                        |

### Wholesale side selection guardrails

Taking an entire side (`--ours` / `--theirs` or keeping one conflict block verbatim) is only safe when
the other side's changes in that region are trivially reconcilable.

| Safe to take one side wholesale                               | NOT safe — must merge manually                     |
| ------------------------------------------------------------- | -------------------------------------------------- |
| Other side's changes are formatting/whitespace only           | Both sides have substantive logic changes          |
| Other side only reordered imports                             | Both sides added new code in the same region       |
| Conflict is in a generated or lock file (will be regenerated) | One side removed code the other side modified      |
| One side's change is a strict subset of the other             | Both sides changed function signatures differently |

Before selecting a whole side, run `git show <commit> -- <file>` for the side you would drop
and confirm its changes are present elsewhere or are not meaningful.

### Modify/delete conflicts (UD — modified locally/deleted remotely, DU — deleted locally/modified remotely)

1. Identify which side deleted and which modified.
2. Inspect the deletion commit to determine intent:

```bash
# Find the commit that deleted the file on the deleting side
git log --diff-filter=D --oneline -1 -- <file>

# Examine the commit to understand why
git show <deletion-commit-sha>
```

3. Classify the deletion:

| Deletion context                                                                             | Resolution                                                                                        |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Dedicated cleanup/refactor commit (message says "remove", "deprecate", "delete", "clean up") | Deletion was intentional — default to deleting unless the modification is critical new work       |
| Feature commit that reorganized code (moved, not removed)                                    | Check where the code moved to; merge the modification into the new location                       |
| Incidental to a large commit with no mention in the message                                  | Ask via an `<interaction>AskUserQuestion</interaction>` block — deletion may have been accidental |

4. If still uncertain, ask:

<interaction>
AskUserQuestion(
  header: "Keep/delete",
  question: "<file> was modified on one side but deleted on the other. The modification: <brief description>. The deletion was in commit <sha>: <message>. The deletion appears <intentional|incidental>. Keep the modified version or delete?",
  options: [
    "Keep modified" -- Stage the modified version with git add,
    "Delete" -- Stage deletion with git rm
  ]
)
</interaction>

### Add conflicts (AU — added by us, UA — added by them)

1. Review the added file's content and purpose.
2. If keeping: `git add <file>`
3. If removing: `git rm <file>`
4. If both sides added with different content: treat as a standard UU conflict.

### When uncertain about any conflict

**Do NOT guess about business logic.** Ask via an `<interaction>AskUserQuestion</interaction>` block.

For **merge** conflicts:

<interaction>
AskUserQuestion(
  header: "Conflict",
  question: "Conflict in <file>: <brief description of both sides>. How should this be resolved?",
  options: [
    "Keep local (ours)" -- Use the local/HEAD version,
    "Keep remote (theirs)" -- Use the incoming version,
    "Merge both" -- Combine changes from both sides,
    "Leave unresolved" -- Skip this file for manual resolution
  ]
)
</interaction>

For **rebase** conflicts (ours = upstream, theirs = your feature branch):

<interaction>
AskUserQuestion(
  header: "Rebase",
  question: "Conflict in <file> while replaying your commit '<commit message>'. Upstream (HEAD) has: <ours summary>. Your branch has: <theirs summary>. How should this be resolved?",
  options: [
    "Keep your branch change (theirs)" -- Preserve your feature branch work,
    "Keep upstream (ours)" -- Discard your branch's version for this section,
    "Merge both" -- Combine both sides,
    "Leave unresolved" -- Skip this file for manual resolution
  ]
)
</interaction>

### Version and changelog conflicts

When a version field or changelog conflicts, the upstream (main) side has released a new version. **NEVER merge version entries.** The upstream release history is immutable.

**Resolution rule:** Keep all upstream version entries and release notes exactly as they are. Bump your version to be strictly above the upstream version, then add your changelog entry as the newest.

| File                                                                                                               | How to resolve                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Version fields** (package.json `version`, plugin.json `version`, Cargo.toml `version`, pyproject.toml `version`) | Take the upstream version. If your version was equal or higher, bump to the next appropriate semver above upstream (e.g., upstream released `1.3.0`, your branch had `1.3.0` -> bump to `1.4.0`). |
| **Changelogs** (CHANGELOG.md, HISTORY.md, CHANGES.md)                                                              | Keep ALL upstream entries untouched. Add your entry above the upstream's latest, with the new bumped version.                                                                                     |
| **Release manifests** (versions.json, lerna.json, release-please config)                                           | Same as version fields: upstream wins, then bump yours above.                                                                                                                                     |

| Rationalization                                      | Reality                                                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| "Both versions are the same, so I can keep either"   | The upstream entry represents a published release. Your entry represents unreleased work. Bump yours. |
| "I'll merge the changelog entries under one version" | Each version in a changelog represents a distinct release. Combining them rewrites release history.   |
| "My version is higher, so I should keep mine"        | Upstream was released first. Its version is now occupied. Bump yours above it.                        |

### Other special cases

| File type                                                                           | Resolution approach                                                                                                    |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Lock files** (package-lock.json, pnpm-lock.yaml, yarn.lock, Gemfile.lock, go.sum) | Accept either version, then regenerate: delete the lock file, run the package manager install, stage the new lock file |
| **Generated files** (.pb.go, .generated.ts, compiled assets)                        | Accept either version, then regenerate using the project's build command                                               |
| **Import conflicts**                                                                | Keep both imports, remove duplicates, respect project ordering conventions                                             |
| **Formatting-only conflicts**                                                       | Apply project formatting conventions consistently                                                                      |

## Step 4: Stage Resolved Files

After resolving each file:

```bash
# For kept/merged files
git add <file>

# For deleted files
git rm <file>
```

## Step 5: Verify Resolution

Run in parallel:

```bash
# Confirm no whitespace or conflict-marker problems in the working changes
git diff --check

# Verify all conflicts are resolved (should show no unmerged paths)
git status
```

**If conflict markers remain:** go back to Step 3 for the affected files.

### Verify both sides' changes are preserved (ALL operation types)

For **every** resolved conflict (not just during rebase), verify that both sides' meaningful changes survived:

1. **Review the resolved file** against each side's intent (identified in Step 2).
2. For each side, confirm:
   - Additions from that side are present in the resolved file (or were intentionally excluded with justification).
   - Modifications from that side are reflected in the resolved file.
   - Intentional removals from that side are still removed — code was not re-added by the other side's block.
3. If any meaningful change was silently dropped, re-open the file and restore it before continuing.

**During rebase — additional check for the commit being replayed:**

Get the SHA of the commit currently being applied:

```bash
git_dir=$(git rev-parse --git-dir)
cat "$git_dir/rebase-merge/stopped-sha" 2>/dev/null \
  || cat "$git_dir/rebase-apply/original-commit" 2>/dev/null
```

Then inspect what that commit intended:

```bash
git show <stopped-sha> --stat
git show <stopped-sha> -- <conflicted-file>
```

Confirm the intent of the feature branch commit is present in the resolved version.

| Rationalization                                 | Reality                                                                                            |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| "I checked the conflict markers, that's enough" | A conflict can be syntactically resolved but semantically wrong — one side's intent may be missing |
| "The merge compiled, so it's correct"           | Compilation doesn't verify that both sides' behavioral changes are present                         |
| "I kept both sides' code so nothing was lost"   | Keeping both sides can re-add intentionally deleted code, which is also a loss of intent           |

**Discover the project's automated checks and run them, in order: typecheck, then tests, then format.**
This catches semantic conflicts
(code that merges cleanly but is logically broken —
e.g., a function signature changed on one side while the other side calls it with old arguments).
Detection: check for `tsconfig.json` (-> `npx tsc --noEmit`), `mypy.ini`/`pyproject.toml` with mypy config (-> `mypy`),
`Cargo.toml` (-> `cargo check`), a `lint`/`test` target in the Makefile (-> `make lint`, `make test`),
or `scripts` in package.json (-> `npm run lint`, `npm test`).
Fix anything the merge broke before reporting. If no checks are found, skip.

## Step 6: Report Results

Provide a summary:

```
Resolved N conflict(s):
- <file1>: <brief resolution description>
- <file2>: <brief resolution description>

Unresolved (if any):
- <file3>: left for manual resolution

To continue:
  merge:       git merge --continue
  rebase:      git rebase --continue
  cherry-pick: git cherry-pick --continue
  revert:      git revert --continue
```

### DO NOT Continue the Operation

**NEVER** automatically run `git merge --continue`, `git rebase --continue`, `git cherry-pick --continue`, `git revert --continue`, or `git commit` after resolving conflicts.

The user must review the resolutions and continue the operation manually.

| Rationalization                                                | Reality                                                                      |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| "All conflicts are resolved, so it's safe to continue"         | The user may want to review resolutions, run tests, or abort                 |
| "The user asked me to fix conflicts, which implies continuing" | Fixing conflicts and continuing the operation are separate actions           |
| "It saves the user a step"                                     | An unwanted merge commit or rebase is harder to undo than typing one command |

## Error Handling

| Error                                            | Action                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Not a git repository                             | Inform the user and stop                                                                                          |
| No conflicts detected                            | Inform the user there are no conflicts to resolve. Stop.                                                          |
| Git status unavailable                           | Fall back to `git diff --name-only --diff-filter=U` for manual detection                                          |
| File too large to read                           | Focus on conflict marker sections using Grep to find `<<<<<<<` line numbers, then Read with offset/limit          |
| Semantic conflict (compiles but logically wrong) | Flag the risk to the user: "These files merged cleanly but may have semantic conflicts — recommend running tests" |
| Automated checks fail after resolution           | Fix what the merge broke before reporting. Do not leave a red tree for the user.                                  |
| Lock file regeneration fails                     | Report the error. Suggest the user run the package manager manually.                                              |
| User chooses "Leave unresolved"                  | Track the file and include it in the unresolved list in Step 6                                                    |
