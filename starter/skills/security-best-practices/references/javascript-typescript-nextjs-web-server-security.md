# Next.js Server Security

> Modified for generic use.

Use this guide for Next.js server-side code, including Route Handlers, API Routes, Server Actions, Proxy or Middleware, and server-rendered pages. Treat TypeScript annotations as compile-time help, not runtime validation.

## Runtime boundaries and authorization

- Treat route parameters, search parameters, headers, cookies, request bodies, Server Action arguments, external data, and stored user content as untrusted.
- Validate every request at runtime. Use explicit schemas, bounds, and allowlists before sensitive operations.
- Treat Server Actions as network-reachable endpoints. Enforce authentication, authorization, input validation, rate limits for sensitive operations, and appropriate CSRF protections.
- Do not rely on UI checks, a hidden route, or Proxy/Middleware matching alone to authorize a protected action. Verify every route and action performs the necessary server-side checks.
- Keep database clients, signing keys, and privileged logic on server-only paths. Treat client-exposed environment variables as public.

## Sessions, CSRF, and deployment

- Use production server settings, keep dependencies patched, and avoid exposing development diagnostics or stack traces.
- For authentication cookies, set `HttpOnly`, a deliberate `SameSite` policy, and `Secure` when HTTPS is in use. Rotate sessions after login or privilege changes.
- Protect cookie-authenticated state-changing requests. Preserve framework Origin/Host protections; additional trusted origins must be narrowly allowlisted.
- Use a restrictive CSP and other appropriate security headers. Verify whether headers are set by the application or edge.
- Apply request-body limits, upload limits, rate limiting, and timeouts at the application and edge as appropriate.

## Data handling

- Do not cache per-user or sensitive data in a shared cache unless the cache is demonstrably user-scoped. Set private or no-store response policies where needed.
- Use response schemas that exclude internal fields. Do not return ORM objects or secrets directly.
- Verify webhook signatures against the raw request body before parsing.
- Use parameterized database queries, avoid shell commands with user-controlled input, and do not evaluate untrusted serialized data.
- Restrict server-side fetches based on user-provided URLs with scheme and destination allowlists, private-address protections, timeouts, response limits, and controlled redirects.
- Build password-reset, callback, and verification URLs from a configured canonical origin, not an unvalidated `Host` or forwarded host.
- Use opaque identifiers for files. Enforce path containment, upload size and type checks, safe storage outside static roots, and safe download behavior.
- Validate redirect targets; prefer same-site relative paths and reject protocol-relative or script-bearing URLs.

## Audit signals

Inventory `app/**/route.*`, `pages/api/**`, `"use server"` actions, Proxy/Middleware matchers, caching directives, `dangerouslySetInnerHTML`, environment access, filesystem APIs, outbound `fetch`, redirect calls, and webhook handlers. Confirm the active framework version and production route behavior before assigning severity.

## Finding format

For each issue, record the rule or category, severity, route or function, file and line, evidence, impact, fix, and mitigation. Label platform or edge protections as requiring runtime verification when not visible in the repository.
