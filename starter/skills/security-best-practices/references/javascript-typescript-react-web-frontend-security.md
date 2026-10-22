# React Frontend Security

> Modified for generic use.

Use this guide for React applications in the browser. Treat all code and configuration shipped to a browser as observable; client-side checks cannot protect server resources.

## Build and trust boundaries

- Ship a production build and keep build-time secrets out of client bundles, public assets, and runtime configuration delivered to the browser.
- Treat URL values, browser storage, cross-window messages, API responses, and persisted user content as untrusted.
- Enforce authorization on the server for every protected resource and action. React-side gating is only a usability feature.

## Rendering and URLs

- Prefer normal JSX interpolation, which escapes text. Avoid `dangerouslySetInnerHTML` and direct DOM sinks such as `innerHTML`, `document.write`, and `insertAdjacentHTML`.
- If user-generated HTML or Markdown must be rendered, disable raw HTML where possible; otherwise use a maintained sanitizer with a restrictive allowlist.
- Validate untrusted URLs used in `href`, `src`, navigation, or redirects. Allow only intended schemes and origins; prefer same-origin relative paths.
- Use a realistic CSP and consider Trusted Types where supported. Keep policies restrictive and do not treat them as replacements for correct rendering.

## Authentication, requests, and third parties

- Avoid storing long-lived access or refresh tokens in Web Storage. Treat storage values as attacker-controlled.
- If requests use ambient cookies, coordinate CSRF protection with the server. SameSite cookies are defense in depth, not a complete substitute.
- Do not send credentials to user-controlled or untrusted origins. Keep API base URLs fixed or allowlisted and handle redirects deliberately.
- Minimize third-party JavaScript. Prefer self-hosting or pinned CDN assets with Subresource Integrity and a restrictive CSP.
- Validate `postMessage` origins exactly, validate message shapes, and use explicit target origins when sending.

## Browser features and files

- Treat service workers as privileged request proxies; avoid caching private responses in shared caches and provide a safe update strategy.
- Treat upload previews as potentially active content. Do not display user-provided HTML, SVG, or similar formats inline without deliberate controls.
- Verify CSP, framing, and other security headers at the server or edge; client markup cannot establish that every response is protected.

## Audit signals

Search for `dangerouslySetInnerHTML`, raw HTML sinks, markdown raw-HTML options, dynamic script loading, `window.location`, `window.open`, `postMessage`, Web Storage, credentialed requests, service-worker caching, and upload previews. Trace values to sources and server-side controls.

## Finding format

Include category, severity, component or function, file and line, evidence, impact, safe fix, and mitigation. For frontend-only findings that depend on a server control, say what must be verified on the backend.
