# Release notes

Add one Markdown file to this directory in each pull request that changes user-visible behavior. Pick a short, unique file name such as `codex-exec-policy.md`.

```md
---
type: fix
---

Keep seeded files when uninstalling.
```

`type` is one of `feat`, `fix`, `perf`, `docs`, or `chore`. The body is one or two sentences written for users; it becomes a bullet in the GitHub release and in `CHANGELOG.md`.

Notes stay in this directory after a release. The release tooling uses git tags to work out which notes belong to which version, so never edit or delete a note that has already been released.
