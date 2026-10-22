# Security policy

## Supported versions

skillerie is pre-1.0. Security fixes go into the latest release only.

## Reporting a vulnerability

Please don't open a public issue. Report it privately through GitHub's vulnerability reporting: open the [Security tab](https://github.com/e-n-0/skillerie/security) of the repository and choose "Report a vulnerability".

Include the skillerie version, your operating system and Node version, the commands you ran, and a minimal configuration repository that reproduces the problem. Remove any real credentials, tokens, or private paths first.

Once a fix is released, an advisory is published that credits the reporter, unless you'd rather stay anonymous.

## Scope

Issues we treat as security problems include:

- writing, replacing, or deleting a file outside the paths an adapter declared, or without a backup;
- following a symlink that redirects an install out of the harness home;
- reporting an agent restriction as enforced when the harness doesn't enforce it;
- leaking environment values or secrets into rendered output, snapshots, manifests, or diagnostics.

skillerie runs `hooks.postInstall` commands and installs assets you opt into. Those run with your permissions by design, so review configuration repositories before installing them.
