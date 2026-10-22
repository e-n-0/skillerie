# Django Web Security

> Modified for generic use.

Use this guide for Django applications. Verify the installed Django version, settings module, middleware order, and production deployment configuration.

## Deployment and secrets

- Do not use Django's development server in production. Disable `DEBUG` and use a production WSGI or ASGI server.
- Keep `SECRET_KEY`, database credentials, and other secrets outside source control and logs. Use a secret manager or protected environment/configuration.
- Configure `ALLOWED_HOSTS` narrowly. Do not use a wildcard as a substitute for host validation.
- Run Django's deployment checks against production settings and review security advisories for Django and security-critical dependencies.

## HTTPS, sessions, and CSRF

- When the site uses HTTPS, configure secure session and CSRF cookies and enforce HTTPS at the appropriate layer. Set proxy SSL headers only when the trusted proxy strips and rewrites client-supplied values.
- Keep session cookies HttpOnly and use an intentional SameSite policy. Scope cookie domains narrowly.
- Keep `CsrfViewMiddleware` enabled. Include CSRF tokens in internal state-changing forms and send the configured token for AJAX requests. Treat exemptions as security-sensitive and provide an appropriate alternative for signed webhooks.
- Do not use GET requests for state-changing actions.

## Authorization, templates, and data access

- Enforce authorization for every privileged view and per-object access. Authentication alone does not grant permission to every object.
- Keep template autoescaping on. Avoid `mark_safe`, `|safe`, broad `autoescape off`, and untrusted template source.
- Use the ORM or parameterized raw SQL. Never interpolate untrusted input into SQL; do not quote parameter placeholders.
- Validate input with forms or schemas and shape responses to disclose only intended fields.
- Do not expose secrets or sensitive request data in logs or error responses. Keep `DEBUG=False` in production.

## Uploads, paths, and headers

- Treat uploads as untrusted. Enforce size and type limits, store them outside executable/static roots, generate storage names, and serve active content safely.
- Keep `MEDIA_ROOT` separate from `STATIC_ROOT`. Use server-side identifiers rather than request-provided paths and prevent path traversal.
- Configure security headers, clickjacking protection, and CSP in Django or at a verified edge. Keep HSTS settings deliberate because mistakes can affect future access.
- Use a strict CORS allowlist only when cross-origin access is required.

## Audit signals

Inspect `DEBUG`, `SECRET_KEY`, `ALLOWED_HOSTS`, middleware, cookie settings, `csrf_exempt`, `mark_safe`, `|safe`, raw SQL calls, file access, redirects, and upload handling. Trace request values and verify production settings rather than inferring them from development configuration.

## Finding format

For each finding, include category, severity, view or function, file and line, evidence, impact, fix, and mitigation. State when a control may be supplied by an uninspected proxy or deployment layer.
