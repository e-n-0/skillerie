# jQuery Frontend Security

> Modified for generic use.

Use this guide for browser applications that use jQuery. Confirm the loaded and bundled jQuery versions; the source code may not match the runtime library.

## Dependency and script loading

- Keep jQuery and security-sensitive plugins on supported, patched releases.
- Prefer dependencies bundled through a lockfile. For CDN assets, use a trusted origin, pinned version, and Subresource Integrity.
- Treat every third-party script as code running with the page's origin privileges. Minimize scripts and constrain them with CSP.

## HTML and script sinks

- Treat jQuery HTML-string APIs as parsing and execution boundaries. Do not pass attacker-controlled values to `.html()`, `.append()`, `.before()`, `.after()`, `.replaceWith()`, `$("<...>")`, or `jQuery.parseHTML`.
- Use `.text()` for plain text, `.val()` for form values, and create nodes with fixed tag names for structured UI.
- If user-generated HTML must be displayed, sanitize it with a maintained library and a restrictive allowlist before insertion. Never use a homegrown regex sanitizer.
- Treat `.load()` as HTML insertion; avoid untrusted URLs or returned fragments.
- Avoid `$.getScript`, script-typed AJAX, JSONP, `$.globalEval`, `eval`, and dynamic script injection. Prefer data formats such as JSON and fixed, reviewed code.

## URLs, attributes, and selectors

- Validate untrusted values assigned to `href`, `src`, `action`, and navigation destinations. Reject dangerous schemes and allowlist external hosts where needed.
- Do not set event-handler attributes or arbitrary CSS strings from untrusted values. Use event listeners and predefined classes.
- Do not concatenate raw user input into jQuery selectors. Use `jQuery.escapeSelector` for dynamic identifiers when available or select through stable IDs and data mappings.

## Requests, CSRF, and object merging

- For cookie-authenticated state-changing requests, send and validate a CSRF token; AJAX usage by itself is not a CSRF defense.
- Do not use JSONP for untrusted endpoints. Prefer JSON over HTTPS with explicit server-side CORS policy.
- Avoid deep-merging untrusted objects with `$.extend(true, ...)`. Construct objects from validated, allowlisted fields and reject prototype-related keys.
- Keep long-lived tokens out of browser storage where possible; assume any value accessible to JavaScript can be read by injected script.

## Audit signals

Search for `.html(`, `.append(`, `.load(`, `$(` with dynamic strings, `parseHTML`, `getScript`, `dataType: "script"`, `jsonp`, `.attr("href"`, `.attr("src"`, `$.extend(true`, and selector concatenation. Trace the value into the call and confirm jQuery's actual runtime version.

## Finding format

Report category, severity, file and line, evidence, impact, remediation, and any uncertainty about data origin or runtime version.
