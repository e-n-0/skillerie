# Flask Web Security

> Modified for generic use.

Use this guide for Flask applications and their WSGI deployment. Check the installed Flask, Werkzeug, template engine, and session-extension versions before making version-specific claims.

## Deployment, configuration, and sessions

- Do not use Flask's development server or interactive debugger in production.
- Load a strong `SECRET_KEY` and other credentials from protected configuration; do not hard-code or log them.
- Configure trusted hosts and proxy handling deliberately. Never trust forwarded headers from arbitrary clients.
- Use production session settings. Set `Secure` when HTTPS is in use, `HttpOnly`, a deliberate SameSite policy, and bounded lifetimes.
- Flask's default session cookie is signed rather than encrypted. Keep secrets and sensitive personal data out of it; clear or rotate session state after login and privilege changes.

## CSRF, authorization, and responses

- Protect all state-changing endpoints that use cookie authentication against CSRF. A custom header can be defense in depth but should not be treated as a universal replacement for a token strategy.
- Do not change state through GET routes.
- Enforce authentication and authorization server-side on every sensitive action and per-object operation.
- Return generic client errors in production. Redact credentials, cookies, and sensitive request data from logs.
- Use strict CORS allowlists only when cross-origin access is necessary.

## Templates, files, and injection

- Keep Jinja autoescaping enabled. Do not mark untrusted values as safe or build templates from user-controlled strings.
- Validate request data before using it in HTML, redirects, database queries, filesystem operations, or subprocesses.
- Use parameterized SQL or a safely parameterizing ORM.
- Use safe file-serving helpers with a trusted base directory. Never pass user-controlled paths directly to `send_file`; generate unique server-side upload names and validate file content.
- Store uploads outside executable/static roots, enforce size limits, and serve active formats as attachments unless explicitly required.
- Avoid shell commands with user input. If a subprocess is necessary, use an argument list, fixed executable, and strict allowlists; do not use `shell=True`.
- Restrict outbound requests based on user-provided URLs with protocol and destination checks, timeouts, response limits, and redirect controls.
- Validate redirects using same-origin rules or exact allowlists.

## Headers and request limits

- Set request and form limits appropriate to the application and enforce additional limits at the edge.
- Configure CSP, content-type sniffing protection, and framing controls in the app or at a verified edge.
- Enable HSTS only with a deliberate HTTPS deployment plan.

## Audit signals

Inspect `debug`, `SECRET_KEY`, trusted-host and proxy settings, cookie flags, CSRF integrations, `Markup`, `|safe`, `render_template_string`, file APIs, upload routes, raw SQL, subprocess use, outbound HTTP clients, redirects, and CORS configuration. Confirm whether suspicious code is reachable in production.

## Finding format

Include category, severity, view or function, file and line, evidence, impact, fix, and mitigation. Mark proxy and hosting controls as unverified when the deployment configuration is outside the inspected scope.
