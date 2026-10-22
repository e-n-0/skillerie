# Security

## Secrets

- Never hardcode or commit credentials, tokens, or private keys.
- Use the repository's approved secret injection or storage mechanism.
- Validate required configuration without exposing secret values.
- Do not log credentials or secret-bearing files. Redact evidence before
  reporting a finding.

## Input and output boundaries

- Validate untrusted input at system boundaries, including type, size, and
  domain constraints.
- Enforce authorization in the system that performs the operation.
- Parameterize SQL values. Use validated allowlists for dynamic identifiers.
- Use context-appropriate output escaping.
- Sanitize intentionally accepted HTML with a maintained, configured
  sanitizer; escaping and sanitization are different controls.

## Findings and remediation

- Avoid actions that expose data or make an incident worse.
- Report the affected boundary, likely impact, and redacted evidence.
- Distinguish confirmed findings from hypotheses.
- Discovering a security issue does not authorize secret rotation, credential
  replay, history rewriting, or changes to production systems or accounts.
  Get the responsible owner's direction before taking those actions.
