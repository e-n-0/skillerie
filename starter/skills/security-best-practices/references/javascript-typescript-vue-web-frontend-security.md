# Vue Frontend Security

> Modified for generic use.

Use this guide for Vue applications in the browser, including applications built with common bundlers. Confirm whether the app uses client-side rendering, server-side rendering, or both.

## Templates and rendering

- Keep Vue templates developer-controlled. Never compile templates supplied by users; template syntax can execute code in the application's context.
- Prefer Vue's default escaping for text and attribute bindings. Avoid `v-html`, `innerHTML`, and raw HTML rendering for untrusted content.
- If rich text is required, sanitize with a maintained HTML sanitizer and a restrictive allowlist. Treat sanitized markup as a carefully reviewed exception.
- Mount Vue into a controlled root rather than compiling arbitrary server-rendered or user-provided DOM.
- Treat style values and event-handler bindings as dangerous when they can be influenced by users. Use fixed classes and developer-defined event handlers.

## URLs, identity, and requests

- Validate URLs before binding to `href`, `src`, `action`, `window.location`, `window.open`, or router navigation. Reject script-bearing schemes and prefer internal named routes or relative paths.
- Validate `next`, `redirect`, and similar destinations against same-origin rules or a strict allowlist.
- Do not put secrets in browser bundles or client-exposed environment variables.
- Do not rely on Vue Router guards or hidden UI for authorization. Enforce permissions on the server.
- For cookie-authenticated state changes, coordinate CSRF tokens, origin checks, and SameSite policy with the backend. Do not weaken CORS or CSRF protections to resolve browser errors.
- Avoid long-lived tokens in Web Storage; treat stored values as untrusted.

## Deployment and third-party code

- Deploy production builds rather than development or preview servers.
- Use CSP and framing protections at the serving layer. Avoid broad script policies.
- Minimize third-party scripts and use pinned, integrity-checked assets when loading from a CDN.
- For server-side rendering, safely serialize initial state and never concatenate untrusted values into templates or script blocks.
- Treat uploaded files and previews as malicious; rely on server-side type validation and avoid rendering active formats inline.

## Audit signals

Search for `v-html`, `innerHTML`, template compilation, `:href`, `:src`, `:style`, dynamic script creation, router guards, Web Storage, credentialed requests, and SSR state serialization. Verify data origin, runtime behavior, and backend enforcement.

## Finding format

Report category, severity, component, file and line, evidence, impact, fix, and mitigation. Mark deployment protections as unverified when they are not visible in the inspected scope.
