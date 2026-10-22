# Release notes

Each pull request that changes user-visible behavior adds one file named after its PR number, for example `.changes/42.yaml`. Open the pull request first to get the number, then push the note.

```yaml
type: fix
description: Keep seeded files when uninstalling.
```

`type` is one of `feat`, `fix`, `perf`, `docs`, or `chore`. `description` is one or two sentences written for users; it becomes a bullet in the GitHub release, followed by a link to the pull request.

Notes stay in this directory after a release. The release job uses git tags to find the notes added since the previous version, so never edit or delete a note that has already been released.
