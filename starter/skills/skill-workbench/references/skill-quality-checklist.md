# Skill quality checklist

## Entry point

- [ ] Frontmatter parses and contains `name`, `description`, `argument-hint`, and `user-invocable`.
- [ ] Name is kebab-case and matches the skill directory.
- [ ] Description starts with `Use when` and names likely trigger requests.
- [ ] Description does not summarize the workflow.
- [ ] Announce line appears immediately after the title.
- [ ] Steps have numbered headings and observable actions.
- [ ] The final section is `Error Handling`.
- [ ] The entrypoint focuses on the common path.

## Content and structure

- [ ] Instructions distinguish required checks from judgment calls.
- [ ] Important failure modes have specific recovery steps.
- [ ] Examples are neutral, accurate, and safe to reuse.
- [ ] Support files are linked, one level deep, and useful on demand.
- [ ] Cross-references resolve to skills in the active set.
- [ ] No private paths, credentials, names, accounts, or internal services remain.
- [ ] Existing third-party license files and required attribution are retained.

## Verification

- [ ] Behavioral testing matches the kind of change.
- [ ] Repository frontmatter, reference, and structure checks pass.
- [ ] Description selection was tested when the selection mechanism exposes results.
- [ ] The report distinguishes completed checks from checks not run.
