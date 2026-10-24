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
