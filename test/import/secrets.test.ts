import { expect, it } from "vitest";
import { scrubServer, scrubSettings } from "../../src/import/secrets.js";

it("removes secret header and env values but keeps references and plain settings", () => {
  // Given: a server mixing inline secrets, environment references and plain values.
  const server = {
    url: "https://docs.example.com/mcp",
    headers: { Authorization: "Bearer sk-live-1234567890abcdef", "X-Team": "core" },
    env: { API_KEY: "abc123", TOKEN_REF: "{env:DOCS_TOKEN}", REGION: "eu" },
  };
  // When: the server is scrubbed.
  const result = scrubServer(server);
  // Then: only the secret values are gone and their fields are reported.
  expect(result.server).toEqual({
    url: "https://docs.example.com/mcp",
    headers: { "X-Team": "core" },
    env: { TOKEN_REF: "{env:DOCS_TOKEN}", REGION: "eu" },
  });
  expect(result.secrets).toEqual(["env.API_KEY", "headers.Authorization"].sort());
});

it("drops secret command arguments together with their flag", () => {
  // Given: a command passing a token as a separate value, an inline value, and a bare key.
  const server = {
    command: "tracker",
    args: [
      "--token",
      "abc123456789",
      "--api-key=xyz",
      "ghp_abcdefghijklmnopqrstuvwxyz12",
      "--verbose",
    ],
  };
  // When: the server is scrubbed.
  const result = scrubServer(server);
  // Then: the command still has its non-secret arguments and every secret position is reported.
  expect(result.server.args).toEqual(["--verbose"]);
  expect(result.secrets).toEqual(["args.1", "args.2", "args.3"]);
});

it("leaves a server without secrets untouched", () => {
  // Given: a plain command server.
  const server = {
    command: "node",
    args: ["/opt/tracker.js"],
    env: { TRACKER_URL: "https://t.example.com" },
  };
  // When: the server is scrubbed.
  const result = scrubServer(server);
  // Then: nothing changes.
  expect(result).toEqual({ server, secrets: [] });
});

it("removes secret settings at any depth and keeps plain words and references", () => {
  // Given: provider keys nested in settings, a credential store mode, and an environment reference.
  const settings = {
    model: "anthropic/claude",
    mcp_oauth_credentials_store: "keyring",
    provider: {
      anthropic: {
        options: { apiKey: "fake-provider-key-0123456789", baseURL: "https://api.example.com" },
      },
      local: { options: { apiKey: "{env:LOCAL_KEY}" } },
    },
    headers: [{ name: "x", client_secret: "abcdefghijklmnop" }],
  };
  // When: the settings are scrubbed.
  const result = scrubSettings(settings);
  // Then: only the secret values are removed and reported by path.
  expect(result.value).toEqual({
    model: "anthropic/claude",
    mcp_oauth_credentials_store: "keyring",
    provider: {
      anthropic: { options: { baseURL: "https://api.example.com" } },
      local: { options: { apiKey: "{env:LOCAL_KEY}" } },
    },
    headers: [{ name: "x" }],
  });
  expect(result.secrets).toEqual(["provider.anthropic.options.apiKey", "headers.0.client_secret"]);
});

it("strips credentials from MCP URLs and drops credential header arguments", () => {
  // Given: credentials in a URL's user info and query, a header passed as arguments, and a URL argument.
  const server = {
    url: "https://user:hunter2@mcp.example.com/sse?token=abc&region=eu",
    args: [
      "--header",
      "Authorization: Bearer abc",
      "-H",
      "X-Team: core",
      "postgres://db:pw@localhost/app",
    ],
  };
  // When: the server is scrubbed.
  const result = scrubServer(server);
  // Then: the URLs keep only their safe parts, the credential header and its flag are gone.
  expect(result.server.url).toBe("https://mcp.example.com/sse?region=eu");
  expect(result.server.args).toEqual(["-H", "X-Team: core", "postgres://localhost/app"]);
  expect(result.secrets).toEqual(["args.1", "args.4", "url"]);
  expect(JSON.stringify(result.server)).not.toMatch(/hunter2|Bearer abc|pw@/);
});

it("removes short keys, header lines, URL credentials, and literals that only contain a reference", () => {
  // Given: settings with a short key, a mixed literal, nested header lines, and an authenticated URL.
  const settings = {
    apiKey: "abc",
    password: "pw",
    mixedKey: { apiKey: "sk1{env:KEY}" },
    safeKey: { apiKey: "{env:KEY}" },
    headers: [["Authorization: Basic dXNlcjpwYXNz", "X-Team: core"]],
    endpoint: "https://admin:secret@api.example.com/v1",
  };
  // When: the settings are scrubbed.
  const result = scrubSettings(settings);
  // Then: every credential is removed or stripped and only whole references survive.
  expect(result.value).toEqual({
    mixedKey: {},
    safeKey: { apiKey: "{env:KEY}" },
    headers: [["X-Team: core"]],
    endpoint: "https://api.example.com/v1",
  });
  expect([...result.secrets].sort()).toEqual(
    ["apiKey", "endpoint", "headers.0.0", "mixedKey.apiKey", "password"].sort(),
  );
});

it("keeps fields that name an environment variable instead of holding a credential", () => {
  // Given: a Codex-style server pointing at a token through an environment variable name.
  const server = { url: "https://docs.example.com/mcp", bearer_token_env_var: "DOCS_TOKEN" };
  // When: the server is scrubbed.
  const result = scrubServer(server);
  // Then: the reference survives and nothing is reported.
  expect(result).toEqual({ server, secrets: [] });
});

it("catches word-based token parameters, inline header flags, and credentials nested under a sensitive key", () => {
  // Given: token-like query names, an inline header flag, and a deeply nested key list.
  const server = {
    url: "https://mcp.example.com/sse?accessToken=a1&auth_token=b2&private_token=c3&region=eu",
    args: ["--header=X-Goog-Api-Key: g7", "--header=X-Team: core"],
  };
  const settings = { apiKey: [[{ value: "nested-secret" }]], credentials: { store: "file" } };
  // When: both are scrubbed.
  const scrubbedServer = scrubServer(server);
  const scrubbedSettings = scrubSettings(settings);
  // Then: every credential is gone and ordinary query data and headers survive.
  expect(scrubbedServer.server.url).toBe("https://mcp.example.com/sse?region=eu");
  expect(scrubbedServer.server.args).toEqual(["--header=X-Team: core"]);
  expect(scrubbedSettings.value).toEqual({ apiKey: [[{}]], credentials: {} });
  expect(JSON.stringify([scrubbedServer, scrubbedSettings])).not.toMatch(
    /a1|b2|c3|g7|nested-secret/,
  );
});

it("keeps ordinary settings that only resemble credential words", () => {
  // Given: Codex and provider settings with words like authority, keyring, and a plain URL.
  const settings = {
    mcp_oauth_credentials_store: "keyring",
    authority: "https://login.example.com",
    endpoint: "https://api.example.com/v1?region=eu",
    keyboard: "vim",
  };
  // When: the settings are scrubbed.
  const result = scrubSettings(settings);
  // Then: nothing is removed.
  expect(result).toEqual({ value: settings, secrets: [] });
});

it("splits acronym-prefixed names such as APIToken into credential words", () => {
  // Given: query names and settings keys that start with an acronym.
  const server = {
    url: "https://mcp.example.com/sse?APIToken=x1&APISecret=x2&JWTToken=x3&region=eu",
  };
  const settings = { APIKey: "x4", HTTPProxy: "http://proxy.example.com:8080" };
  // When: both are scrubbed.
  const scrubbedServer = scrubServer(server);
  const scrubbedSettings = scrubSettings(settings);
  // Then: the credentials are removed and the proxy setting survives.
  expect(scrubbedServer.server.url).toBe("https://mcp.example.com/sse?region=eu");
  expect(scrubbedSettings.value).toEqual({ HTTPProxy: "http://proxy.example.com:8080" });
});

it("keeps only allowlisted query parameters, whatever the other names look like", () => {
  // Given: credential spellings that defeat name matching, a harmless unknown name, and allowlisted names.
  const names = [
    "APITOKEN",
    "APIToken2",
    "APIKEYV2",
    "authv2",
    "AUTHORIZATIONV2",
    "OAuthIssuer",
    "q",
  ];
  const url = `https://mcp.example.com/sse?${names.map((name) => `${name}=v`).join("&")}&Region=eu&api-version=2`;
  // When: the server is scrubbed.
  const result = scrubServer({ url });
  // Then: only the allowlisted parameters survive and the URL is reported.
  expect(result.server.url).toBe("https://mcp.example.com/sse?Region=eu&api-version=2");
  expect(result.secrets).toEqual(["url"]);
});
