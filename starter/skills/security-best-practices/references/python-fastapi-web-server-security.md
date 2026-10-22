# FastAPI and ASGI Web Security

> Modified for generic use.

Use this guide for FastAPI services and their ASGI stack. Check the actual FastAPI, Starlette, ASGI server, validation-library, and multipart-parser versions before making advisory claims.

## Production and API boundaries

- Disable debug tracebacks and auto-reload in production; use a production server configuration with appropriate workers, timeouts, and resource limits.
- Decide deliberately whether API documentation endpoints should be public; protect or disable them when they expose sensitive internal interfaces.
- Apply authentication consistently through dependencies or protected routers. Enforce object-level and property-level authorization on every sensitive operation.
- Treat query, path, body, header, cookie, upload, and WebSocket data as untrusted. Use explicit request models, reject unexpected fields where appropriate, and validate identifiers before side effects.
- Define response models that exclude internal fields, credentials, and password hashes.

## Authentication, sessions, and browser controls

- Prefer standard authorization headers for bearer tokens; avoid putting secrets in URLs.
- Verify JWT signatures with an algorithm allowlist and validate expiry and relevant issuer/audience claims. Keep secrets out of token payloads.
- If using cookie sessions, set Secure when HTTPS is in use, HttpOnly, an intentional SameSite policy, bounded lifetimes, and server-side storage for sensitive state.
- Protect cookie-authenticated state-changing requests against CSRF. CORS does not provide authentication and should remain disabled unless needed.
- Allowlist exact CORS origins, methods, and headers. Never combine wildcard origins with credentials.
- Validate host and forwarded headers. Trust forwarded values only from known proxies with controlled header rewriting.

## Requests, files, and injection

- Enforce body, multipart, file-count, and file-size limits in the application and edge.
- Keep uploaded files out of static roots; validate content, use generated storage identifiers, and serve potentially active formats as attachments.
- Use opaque file identifiers and safe base directories. Never pass untrusted paths to `FileResponse`, `StaticFiles`, or direct file APIs without containment checks and authorization.
- Use parameterized database operations and explicit query fields; avoid mass assignment from arbitrary dictionaries.
- Avoid shell commands with untrusted input; if unavoidable, use a fixed executable and validated argument arrays without a shell.
- Restrict outbound requests to user-provided URLs with allowlisted schemes and destinations, private-address protections where appropriate, timeouts, bounded responses, and controlled redirects.
- Validate redirects and authenticate WebSocket connections. Check browser WebSocket origins where appropriate and bound message rates and connection lifetimes.
- Use safe HTML templates and never render user-controlled template source.

## Dependencies and audit signals

Keep FastAPI, Starlette, the ASGI server, and multipart/file-serving dependencies patched. Review advisories when affected features are present. Inspect debug/reload flags, docs configuration, dependencies, CORS, proxy trust, request models, response models, session settings, `FileResponse`, `StaticFiles`, subprocess calls, outbound clients, redirect responses, and WebSocket handlers.

## Finding format

Report category, severity, route or function, file and line, evidence, impact, remediation, and mitigation. Separate confirmed code defects from runtime or infrastructure questions.
