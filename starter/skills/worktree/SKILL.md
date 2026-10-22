---
name: worktree
description: "Use when you need to create, use, locate, or remove an isolated Git worktree, including one based on a branch, commit, or pull request."
argument-hint: "[--remove [path-or-slug] | --source <pr-url|pr-number|commit|branch>] [short description]"
user-invocable: true
---

# Worktree

Announce: "I'm using the worktree skill to manage an isolated workspace."

## Step 1: Parse Arguments and Inspect the Repository

Parse `$ARGUMENTS`:

- `--remove [path-or-slug]` selects REMOVE mode; the target may be omitted.
- `--source <value>` selects SOURCE mode; the value may be a pull request URL or number, commit SHA, or branch.
- Remaining text is an optional short description used to name the worktree.
- With neither flag, use CREATE mode.

Run these in parallel:

- `git rev-parse --show-toplevel`
- `git worktree list --porcelain`

If the current directory is not in a Git repository, explain that and stop. Set `REPO_ROOT` to the repository root and `REPO_NAME` to its directory name. Treat the first listed worktree as the main worktree; only the others are removable.

## Step 2: REMOVE Mode

Find a removable worktree whose path or basename contains the supplied target, ignoring case. If there is no target, show the removable worktrees. If the target has no match, report that and show the full list.

If the target is missing or ambiguous, select a listed worktree with this interaction:

<interaction>
AskUserQuestion(
  header: "Remove which?",
  question: "Which worktree should I remove?\n<list each removable worktree path and branch>",
  options: [one option for each removable worktree]
)
</interaction>

If there are no removable worktrees, report that and stop.

Before removal, check for uncommitted changes. Remove the selected worktree with `git worktree remove <path>`, then run `git worktree prune`. If Git refuses because the worktree has changes, report the changes and ask before using `git worktree remove --force <path>`. Do not discard work without the user's explicit choice.

Report the removed path and that stale worktree references were pruned, then stop.

## Step 3: Choose the Worktree Name and Location

For CREATE mode, build a slug from the remaining description: lowercase it, replace spaces with hyphens, remove characters other than letters, numbers, and hyphens, and limit it to 50 characters. If no description was provided, ask:

<interaction>
AskUserQuestion(
  header: "Worktree name",
  question: "What is this worktree for? Give a short description or ticket identifier.",
  options: [
    { label: "Ticket identifier", description: "Use a short issue or ticket ID." },
    { label: "Short description", description: "Use a concise description of the work." }
  ]
)
</interaction>

For SOURCE mode, use the source value as the initial slug: branch names replace `/` with `-`; commit SHAs use the first eight characters; pull requests use `pr-<number>-<branch-slug>`. An optional description overrides this slug. For a pull request, use `gh pr view <number-or-url> --json number,headRefName,title` to obtain its number and branch.

Use `$REPO_ROOT/../worktrees/` as the worktrees directory, creating it if needed. Build the path as `<worktrees-dir>/<REPO_NAME>-<slug>`.

If the path is already registered by `git worktree list`, ask whether to reuse it or replace it. In CREATE mode, also offer to choose a different name. Reuse only a registered worktree. If a non-worktree file or directory occupies the path, stop and ask for a different name; do not remove it.

<interaction>
AskUserQuestion(
  header: "Worktree exists",
  question: "A worktree already exists at <path>. What should I do?",
  options: [
    { label: "Reuse existing", description: "Use the registered worktree as it is." },
    { label: "Replace", description: "Remove it and create a fresh worktree; preserve changes unless I explicitly choose to discard them." },
    { label: "Choose different name", description: "Pick another name for the new worktree." }
  ]
)
</interaction>

For SOURCE mode, omit "Choose different name" only if the source slug must be retained. If replacing a worktree with uncommitted changes, ask before force-removing it.

## Step 4: Create or Check Out the Worktree

In SOURCE mode, classify the source as a pull request URL, numeric pull request ID (optionally prefixed with `#`), hexadecimal commit SHA, or branch name.

- Pull request: extract its number, run `git fetch origin`, create a detached worktree at the target path, then run `gh pr checkout <number> --force` from that worktree.
- Branch: run `git fetch origin <branch>`, then `git worktree add <path> origin/<branch>`.
- Commit: run `git fetch origin`, then `git worktree add --detach <path> <sha>`.

In CREATE mode, determine the base branch in this order:

1. Read `refs/remotes/origin/HEAD` and use its branch name.
2. If unresolved, run `git remote set-head origin --auto` and check again.
3. If still unresolved, use `main` if `origin/main` exists, otherwise `master` if `origin/master` exists.
4. If none is available, ask which existing remote branch to use.

Fetch the chosen branch with `git fetch origin <base>`, then run `git worktree add --detach <path> origin/<base>`.

If reuse was selected, skip creation. If a different name was selected, rebuild the slug and path, check for collisions, and continue. If `git worktree list` showed 10 or more worktrees, mention the count and suggest reviewing the list and pruning stale entries.

## Step 5: Report the Result

Report the worktree path and its source or base branch. Include:

```text
Run to enter:
  cd <worktree-path>
```

For CREATE mode, add: "Create your feature branch in this worktree when ready."

## Error Handling

| Error                                        | Action                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Not a Git repository                         | Explain the requirement and stop.                                                              |
| No removable worktrees                       | Report that and stop.                                                                          |
| Removal is blocked by changes                | Show the relevant status and ask before force-removing.                                        |
| Pull request lookup or checkout fails        | Report the `gh` error; if authentication is missing, suggest `gh auth login`.                  |
| Branch is not found on `origin`              | Report the branch name and suggest fetching the remote branch.                                 |
| Commit is not found                          | Report the SHA and suggest fetching the remote that contains it.                               |
| Path exists but is not a registered worktree | Do not overwrite it; ask for another name.                                                     |
| Worktree creation fails                      | Report the full Git error; a common cause is that the branch is already checked out elsewhere. |
| Worktree removal fails                       | Report the Git error and suggest `git worktree prune` for stale references.                    |
