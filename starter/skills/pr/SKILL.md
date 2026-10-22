---
name: pr
description: >
  Use when the user wants to create a GitHub pull request from the current branch,
  push a branch and open a pull request, or mark an existing draft pull request
  ready for review.
argument-hint: "[optional PR title, --base <branch>, --open, or ready]"
user-invocable: true
---

# Create a pull request

Announce: "I'll use the pr skill to create or update a GitHub pull request."

## Step 1: Determine the requested mode

Parse `$ARGUMENTS`:

- If the first word is `ready`, use **Ready mode** to mark an existing draft pull
  request ready for review.
- If `--open` appears, use **Create mode** and mark the new pull request ready
  after creating it as a draft.
- Otherwise, use **Create mode** and leave the new pull request as a draft.

Remove `ready` or `--open` before parsing any remaining title or `--base` value.
In Ready mode, skip to Step 9.

## Step 2: Gather repository context

Run these independent checks:

- `git branch --show-current`
- `git remote`
- `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null`
- `git status --short`
- `gh auth status`
- `gh repo view --json nameWithOwner -q '.nameWithOwner'`

Use the repository's configured GitHub remote when it is clear; otherwise use
`origin`.

If `gh` is missing or unauthenticated, explain that the GitHub CLI must be
installed and authenticated, then stop. If this is not a Git repository, explain
that and stop.

## Step 3: Determine the base branch

Resolve the base in this order:

1. If `$ARGUMENTS` contains `--base <branch>`, use that branch and skip stack
   detection.
2. Otherwise, look for an unmerged parent branch in the current branch stack.
3. If no parent is found, use the repository's default branch.

### Detect a parent branch

First determine the default branch using the fallback procedure below. Then
enumerate branches whose tips are ancestors of the current `HEAD`:

```bash
git branch -a --merged HEAD --format='%(refname:short)'
```

Exclude the current branch, its remote-tracking counterpart, the default branch,
its remote-tracking counterpart, and `origin/HEAD`. Exclude any candidate whose
tip is already an ancestor of the remote-tracking default branch. If both a
local branch and its `origin/<branch>` counterpart remain, keep the remote
counterpart.

For each remaining candidate, calculate its distance from `HEAD`:

```bash
git rev-list <candidate>..HEAD --count
```

Choose the candidate with the smallest positive distance. For a tie, prefer a
candidate with an open pull request, found with
`gh pr list --head <branch> --state open --json number --limit 1`. If multiple
candidates remain tied, select a branch with this interaction:

<interaction>
AskUserQuestion(
  header: "Parent branch",
  question: "More than one possible parent branch is equally close. Which should this pull request target?",
  options: [
    "branch-a" -- Use the first candidate branch,
    "branch-b" -- Use the second candidate branch
  ]
)
</interaction>

Use the selected branch name without the `origin/` prefix. Look up its open pull
request with
`gh pr list --head <branch> --state open --json number,url,title --limit 1`.
If found, record its number, URL, and title for the pull request description.
If the lookup fails or returns no result, continue without parent pull request
details. Tell the user which parent branch was selected and whether it has an
open pull request.

If the parent branch has no corresponding remote-tracking branch, explain that
it must be pushed before it can be used as a base, then fall back to the default
branch.

### Detect the default branch

1. Read `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null` and extract its
   branch name.
2. If that fails, run `git remote set-head origin --auto 2>/dev/null` and retry.
3. If still unresolved, use `main` when `origin/main` exists, otherwise `master`
   when `origin/master` exists.
4. If none is available, ask:

<interaction>
AskUserQuestion(
  header: "Base branch",
  question: "The default branch could not be detected. Which branch should this pull request target?",
  options: [
    "main" -- Use main as the base branch,
    "master" -- Use master as the base branch
  ]
)
</interaction>

## Step 4: Validate the current branch

If the current branch is the base branch, explain that a pull request cannot be
created from the base branch and stop.

If there are uncommitted changes, tell the user they will not be included in the
pull request. Continue without staging or committing them.

## Step 5: Collect commits and changes

Find the divergence point and summarize the changes:

```bash
git merge-base origin/<base> HEAD
git log --format="%h%x09%s%x09%b" <merge-base>..HEAD
git diff --stat origin/<base>..HEAD
git diff --name-only origin/<base>..HEAD
```

If there are no commits between the base and `HEAD`, explain that there is
nothing new to include and stop.

Note issue references and documentation URLs found in commit messages. Include
them only if they help reviewers find relevant context.

## Step 6: Analyze the changes

Choose a summary tier from the changed file count and commit count:

| Tier    | Criteria                                  | Summary format                     |
| ------- | ----------------------------------------- | ---------------------------------- |
| Simple  | 1-3 files and one commit                  | Brief bullets                      |
| Medium  | 4-10 files or 2-5 commits                 | Sections grouped by concern        |
| Complex | 11+ files, 6+ commits, or a critical path | Narrative grouped by flow or stage |

A change is critical when it affects authentication, security, permissions,
payments, billing, migrations, schemas, validation, sanitization, or data
integrity, or when commit messages identify a security fix or breaking change.

For a Simple pull request, the commit messages and diff summary are usually
enough. For a Medium or Complex pull request, read the diff. If it is large,
inspect focused file groups rather than omitting code-level review.

For Medium or Complex changes, also record:

- Relevant tests and the behaviors they cover.
- Demonstration evidence, such as supplied screenshots, recordings, output, or
  reproducible commands. Do not invent evidence.
- The problem and chosen approach, grounded in the commits, linked design
  material, or observable behavior.
- One to three reviewer questions that require judgment about a critical path,
  interaction, failure mode, or irreversible choice.
- Known deviations documented in canonical material. If evidence is unavailable,
  say so rather than claiming there were no deviations.
- Explicit non-goals from canonical material. If none are documented, say so
  rather than inferring promises from unchanged files.

## Step 7: Write the title and description

### Title

Choose the title in this order:

1. Use a title supplied in `$ARGUMENTS`.
2. If the branch name contains a recognizable issue ID, derive a readable title
   from the branch name.
3. If there is one commit, use its subject.
4. Otherwise, write one concise title that captures the main theme of the
   commits.

### Description

Explain why the change exists, what behavior changes, and where reviewers should
focus. The diff already shows each line-level change, so avoid repeating file
names or commit subjects without explaining their significance.

Use only sections with meaningful content. A Simple pull request may use:

1. Documentation, when relevant links or issue references were found.
2. Motivation, when the reason is not already clear from the title.
3. Summary.

For Medium or Complex changes, use this order:

1. Demonstration, when meaningful evidence exists.
2. Documentation, when relevant links or issue references were found.
3. Motivation.
4. Summary.
5. Reviewer questions.
6. Known deviations.
7. Non-goals.

When a parent branch was detected, begin Motivation with a stack reference:

- With an open parent pull request: `> Stacked on #<number> - [<title>](<url>)`
- Without one: `> Stacked on branch BRANCH (no pull request yet)`, replacing
  `BRANCH` with the selected branch name.

Keep the stack reference first, followed by a blank line and the motivation.
Never omit Motivation when the stack reference is needed.

### Summary formats

For Simple changes, use one or two bullets that explain the effect or reason.
Do not pad the list or restate implementation details.

For Medium changes, use `###` headings for concerns rather than file groups.
Lead each section with the problem or constraint, then explain the behavior
change. Add a Tests subsection when tests were included, listing covered
scenarios rather than filenames. Use an alert block for critical changes.

For Complex changes, write a short opening that states the problem and selected
approach, then describe the flow in logical stages. Introduce code snippets with
the reason for the change, keep them to complete 5-15-line units, and follow
them with links to the relevant lines:

```text
https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<start>-L<end>
```

Use `> [!IMPORTANT]` for critical changes and `> [!WARNING]` for irreversible
changes. Place the alert after the code or behavior it describes. Collapse only
routine supporting details, not critical changes. List test scenarios and
observed results only when evidence is available.

Before continuing, check that the description:

1. Explains why the pull request exists.
2. Describes behavior rather than narrating file edits.
3. Gives reviewers a concrete focus where judgment is needed.
4. Uses evidence for links, demonstrations, deviations, and non-goals.
5. Uses valid Markdown and contains no invented results.

## Step 8: Push and create a draft pull request

Check whether the branch has an upstream:

```bash
git rev-parse --abbrev-ref @{upstream} 2>/dev/null
```

If no upstream exists, push with `git push -u origin HEAD`. If an upstream exists
and the branch is ahead, push with `git push`. Never force-push.

Create every pull request as a draft:

```bash
gh pr create --draft --base <base> --head <head> --title "<title>" --body "$(cat <<'EOF'
<description>
EOF
)"
```

Use a single-quoted `EOF` delimiter on its own line so shell expansion does not
change the Markdown description.
Record the pull request URL and current `HEAD` SHA. If `--open` was supplied, go
to Step 9 after recording them. Otherwise, leave the pull request as a draft,
report its URL, and stop.

## Step 9: Check or mark a pull request ready

In Ready mode, inspect the pull request for the current branch:

```bash
gh pr view --json number,state,isDraft,url
```

If there is no pull request, explain that and stop. If it is already open for
review, report its URL and stop.

For a draft pull request created in Step 8 with `--open`, run `gh pr ready`.
In Ready mode, first confirm that the current pull request is a draft, then run
`gh pr ready`.

If marking it ready fails, report the error and leave its state unchanged.
Otherwise, report the URL and confirm it is open for review.

## Error handling

- **GitHub CLI missing or unauthenticated:** explain that `gh` must be installed
  and authenticated; stop.
- **Not a Git repository:** explain the issue; stop.
- **On the base branch:** request a feature branch before continuing; stop.
- **No commits to include:** explain that there are no new commits; stop.
- **Default branch unknown:** use the fallback question in Step 3.
- **Stack parent is ambiguous:** use the parent-branch interaction to select a candidate branch.
- **Push fails:** report the error; do not force-push.
- **Pull request already exists:** report the existing pull request URL and do
  not create a duplicate.
- **Ready operation fails:** report the GitHub CLI error.
- **Network or API failure:** report the error and let the user decide whether
  to retry.
