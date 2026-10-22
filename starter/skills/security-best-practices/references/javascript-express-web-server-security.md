# Express Web Server Security

> Modified for generic use.

Use this guide for Express applications. Confirm the installed Express, Node.js, middleware, and session-library versions before making version-specific claims.

## Audit approach

Inspect application startup, middleware order, proxy configuration, routes, authentication, session handling, templates, static files, outbound requests, and production error behavior. Trace untrusted request values to their sinks and verify the relevant control actually covers each route.

## Production configuration and dependencies

- Run a production build and production server configuration, not a development server or debugger.
- Keep Express, Node.js, and security-sensitive middleware on supported releases. Review lockfiles and security advisories; do not upgrade broadly without considering compatibility.
- Disable `X-Powered-By`; use deliberate 404 and error handlers that do not expose stack traces or secrets to clients.
- Use Helmet or equivalent protections. Configure CSP for the application's actual scripts, and avoid weakening it with broad script allowances.
- Apply request timeouts, connection limits, and body-parser limits appropriate to the deployment. Add edge limits as defense in depth.
- Rate-limit authentication, password-reset, and expensive routes.

## Input, routes, and authorization

- Treat `req.params`, `req.query`, `req.body`, headers, cookies, and uploaded filenames as untrusted. Query values may have unexpected array or object shapes.
- Validate and normalize input at route boundaries with explicit schemas and allowlists.
- Enforce authentication and authorization server-side on every protected action. UI checks are not an authorization boundary.
- Use non-GET methods for state changes and protect cookie-authenticated state changes against CSRF.
- Avoid logging request bodies, credentials, session tokens, or complete sensitive headers.

## Sessions, cookies, proxy trust, and CORS

- Give session cookies a deliberate name and scope. Set `HttpOnly`, `SameSite`, and `Secure` when HTTPS is in use.
- Never use an in-memory development session store in production. Keep signing secrets outside source control; rotate sessions after login or privilege changes.
- Treat signed cookie contents as readable by clients. Do not store secrets or sensitive personal data there.
- Configure `trust proxy` to match the actual proxy chain. Do not blindly trust forwarded headers from the public internet.
- Disable CORS unless required; allowlist exact origins and restrict methods and headers. Never pair wildcard origins with credentialed requests.

## XSS, templates, and files

- Keep framework output escaping enabled. Avoid unsafe HTML insertion and untrusted template source or template paths.
- If user-authored rich HTML is necessary, use a maintained sanitizer with a restrictive allowlist; do not write a regex sanitizer.
- Validate redirect destinations and prefer same-site relative paths.
- Do not pass raw request paths to `res.sendFile`, `res.download`, or filesystem APIs. Use fixed roots, opaque identifiers, authorization checks, and dotfile restrictions.
- Keep user uploads outside static roots. Enforce size limits, validate content rather than extensions alone, generate storage names, and serve active formats as attachments unless explicitly intended.

## Injection and outbound requests

- Use parameterized SQL and construct NoSQL queries from validated fields rather than merging request objects.
- Avoid shell execution with user-controlled data. Prefer library APIs; if spawning is necessary, use a fixed executable and validated argument arrays without `shell: true`.
- Restrict server-side requests based on user-provided URLs. Allowlist destinations, limit protocols and redirects, block private or link-local destinations where relevant, set timeouts, and cap response sizes.
- Do not expose the Node inspector or enable insecure HTTP parsing in production.

## Audit signals

Search and trace `res.redirect`, `res.sendFile`, `res.download`, `express.static`, `express-session`, `trust proxy`, `express.json`, `express.urlencoded`, `child_process`, `shell: true`, `fetch`, raw SQL, and template rendering. Verify source, route reachability, authorization, deployment settings, and middleware order before reporting an issue.

## Finding format

Report each confirmed issue with category, severity, route or function, file and line, evidence, impact, fix, and mitigation. Identify protections that may be configured at the edge as requiring runtime verification.
