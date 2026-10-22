# Go Backend Security

> Modified for generic use.

Use this guide for Go services and command-line applications, especially network-facing code. Confirm the actual Go version, standard-library behavior, deployment model, and dependency policy before making version-specific claims.

## Audit approach

Trace untrusted values from request fields, files, queues, external services, and user-controlled database content to security-sensitive operations. Inspect entrypoints, deployment configuration, authentication, authorization, parsing, storage, outbound requests, logging, and concurrency. Record the protective control that prevents a suspected flow from being exploitable.

## Toolchain and dependencies

- Use a supported Go release and apply security patch releases.
- Keep `go.mod` and `go.sum` under review; do not disable checksum verification for public modules.
- Run a maintained vulnerability scanner for source and dependencies in CI.
- Treat replacement directives, private-module exceptions, and build environment variables as security-sensitive configuration.

## Secrets and configuration

- Load credentials from a secret manager, environment, or restricted configuration file. Never hard-code, log, or commit them.
- Redact authorization headers, cookies, tokens, and credential-bearing connection strings from logs and errors.
- Fail safely when required production configuration is missing.

## HTTP server and resource limits

- Configure a dedicated `http.Server` with justified `ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout`, and `MaxHeaderBytes`.
- Bound request bodies with `http.MaxBytesReader` before decoding. Limit multipart body size, part count, and file size.
- Avoid exposing diagnostic handlers such as pprof or expvar on public listeners. Keep diagnostics on a restricted listener with access controls.
- Apply rate limits or abuse controls to authentication and expensive operations.
- Set browser security headers where appropriate, in the application or at a verified edge.

## Proxies, cookies, and request forgery

- Trust forwarded host, scheme, and client-address headers only when requests came through known proxies that overwrite those headers.
- Build security-sensitive external links from a configured canonical origin, not an unvalidated `Host` value.
- For authentication cookies, use `HttpOnly`, an intentional `SameSite` policy, and `Secure` when the deployment uses HTTPS. Use short, justified lifetimes.
- Protect state-changing requests authenticated by ambient cookies with a CSRF defense. Bearer-token APIs have a different CSRF threat model.
- Disable CORS unless needed. When enabled, allowlist exact origins and restrict methods and headers; do not combine wildcard origins with credentials.

## Input, templates, files, and injection

- Validate type, structure, length, and allowed values at request boundaries. Treat parsed JSON and query values as untrusted.
- Use `html/template` for HTML. Do not mark user-controlled content as trusted template HTML, JavaScript, or URLs. Never execute templates supplied by users in the application's trust domain.
- Map opaque file identifiers to server-side paths. Enforce base-directory containment, bound uploads, validate content, and keep uploads outside executable or public static roots.
- Use parameterized SQL. Do not concatenate untrusted values into SQL.
- Avoid shell execution with untrusted values. If a subprocess is necessary, use a fixed executable, argument arrays, strict allowlists, and `exec.CommandContext`; do not invoke a shell to interpolate input.
- Restrict outbound requests influenced by users: allowlist destinations, restrict schemes, block private and link-local addresses as appropriate, limit redirects, set timeouts, and cap response size.
- Validate redirect targets; prefer same-origin relative paths.

## Cryptography and concurrency

- Use `crypto/rand` for tokens, keys, and other security-sensitive randomness; never use `math/rand` for secrets.
- Store passwords with an adaptive password hashing scheme such as bcrypt or Argon2id. Use constant-time comparison where appropriate for secret values.
- Minimize `unsafe` and cgo at trust boundaries; isolate and thoroughly test unavoidable uses.
- Protect shared mutable state. Treat data races in authorization, sessions, and caches as security-relevant; run race-enabled tests on important paths.

## Audit signals

Search and trace patterns such as `http.ListenAndServe`, `io.ReadAll(r.Body)`, `ParseMultipartForm`, `http.DefaultClient`, `http.Get`, `http.Redirect`, `http.ServeFile`, `http.FileServer`, `os.Open`, `template.HTML`, `text/template`, `exec.Command`, `sh -c`, `math/rand`, `InsecureSkipVerify`, and pprof registration. A match is a lead, not a finding: establish data origin, runtime reachability, and existing controls.

## Finding format

For each confirmed issue, report a rule or category, severity, file and line, evidence, impact, safe fix, and mitigation. Mark infrastructure-dependent controls as unverified when they are not visible in the inspected scope.
