# Browser JavaScript and TypeScript Security

> Modified for generic use.

Use this guide for browser-side JavaScript or TypeScript when no more specific framework reference applies. Client code and configuration are visible and modifiable by users; they cannot enforce authorization or keep embedded values secret.

## Trust boundaries and XSS

- Treat URL values, browser storage, `postMessage` data, API responses, and persisted user content as untrusted.
- Prefer `textContent`, DOM node construction, and normal framework rendering over `innerHTML`, `outerHTML`, `insertAdjacentHTML`, or `document.write`.
- Avoid `eval`, `Function`, string-based timers, and setting event-handler attributes from strings.
- If rich HTML is required, use a maintained sanitizer with a restrictive allowlist. Keep the sanitize-and-render path narrow and reviewed.
- Deploy a realistic CSP, preferably through response headers. Avoid `unsafe-inline` and `unsafe-eval`; use nonces or hashes where inline scripts are unavoidable.
- Consider Trusted Types where supported as defense in depth, not as a substitute for safe rendering.

## URLs and cross-window messaging

- Validate untrusted values before assigning `href`, `src`, `action`, or navigation targets. Reject script-bearing schemes such as `javascript:`.
- Prefer same-origin relative destinations. If external destinations are required, allowlist exact origins and protocols.
- Send `postMessage` only to an explicit target origin. On receipt, validate exact `event.origin`, expected `event.source` where relevant, and the message schema.
- Treat message data as data: do not evaluate it or insert it as HTML.

## Storage, requests, and third parties

- Do not store long-lived secrets or session identifiers in `localStorage` or `sessionStorage`; XSS can read them. Treat all values loaded from storage as untrusted.
- Do not send authenticated requests to a user-controlled origin. Keep API destinations fixed or allowlisted and use credentials deliberately.
- For cookie-authenticated state-changing requests, coordinate CSRF protection with the server; an AJAX request alone is not protection.
- Minimize third-party scripts. They execute with the page's origin privileges. Prefer self-hosted assets or pinned resources with Subresource Integrity and a restrictive CSP.

## Browser-specific review

- Frontend authorization is only a user-interface convenience; the server must enforce permissions.
- Treat service workers as privileged request handlers. Avoid caching sensitive user-specific responses in shared caches and plan update behavior.
- Treat uploads and previews as malicious. Do not render active user files inline without a deliberate isolation and sanitization strategy.
- Inspect security headers at the serving layer; a meta CSP does not provide every response-header protection.

## Audit signals

Search for `.innerHTML`, `.outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `setAttribute("on...")`, `location.assign`, `postMessage`, `localStorage`, `sessionStorage`, dynamic script creation, and CSP directives. Trace actual data sources and controls rather than treating each match as a vulnerability.

## Finding format

Include category, severity, file and line, evidence, impact, fix, and mitigation. For controls configured by a server or edge, state that they are not visible in the inspected client code and need runtime verification.
