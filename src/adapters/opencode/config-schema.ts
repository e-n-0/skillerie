// Offline validation snapshot from the public OpenCode schema (2026-10-21).
// Documentation-only keywords are omitted; validation keywords are unchanged.
// Pure schema data is kept together to preserve local references.
export const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://opencode.ai/config.json",
  type: "object",
  properties: {
    $schema: {
      type: "string",
    },
    shell: {
      type: "string",
    },
    model: {
      anyOf: [
        {
          type: "string",
          pattern: "^[^/#]+\\/[^#]+(?:#[^#]+)?$",
        },
        {
          type: "object",
          properties: {
            providerID: {
              type: "string",
              pattern: "^[^/#]+$",
            },
            model: {
              type: "string",
              pattern: "^[^#]+$",
            },
            variant: {
              type: "string",
              pattern: "^[^#]+$",
            },
          },
          required: ["providerID", "model"],
          additionalProperties: false,
        },
      ],
    },
    default_agent: {
      type: "string",
    },
    update: {
      type: "string",
      enum: ["disable", "notify", "auto"],
    },
    share: {
      type: "string",
      enum: ["manual", "auto", "disabled"],
    },
    enterprise: {
      type: "object",
      properties: {
        url: {
          type: "string",
        },
      },
      additionalProperties: false,
    },
    username: {
      type: "string",
    },
    permissions: {
      $ref: "#/$defs/Permission.Ruleset",
    },
    policies: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["provider.use", "tool.use", "integration.use"],
          },
          resource: {
            type: "string",
          },
          effect: {
            type: "string",
            enum: ["allow", "deny"],
          },
        },
        required: ["action", "resource", "effect"],
        additionalProperties: false,
      },
    },
    agents: {
      type: "object",
      additionalProperties: {
        $ref: "#/$defs/Config.AgentEncoded",
      },
    },
    snapshots: {
      type: "boolean",
    },
    watcher: {
      type: "object",
      properties: {
        ignore: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      additionalProperties: false,
    },
    formatter: {
      anyOf: [
        {
          type: "boolean",
        },
        {
          type: "object",
          additionalProperties: {
            $ref: "#/$defs/Config.Formatter.EntryEncoded",
          },
        },
      ],
    },
    lsp: {
      anyOf: [
        {
          type: "boolean",
        },
        {
          type: "object",
          additionalProperties: {
            anyOf: [
              {
                type: "object",
                properties: {
                  disabled: {
                    type: "boolean",
                    enum: [true],
                  },
                },
                required: ["disabled"],
                additionalProperties: false,
              },
              {
                $ref: "#/$defs/Config.LSP.ServerEncoded",
              },
            ],
          },
        },
      ],
    },
    media: {
      type: "object",
      properties: {
        image: {
          type: "object",
          properties: {
            auto_resize: {
              type: "boolean",
            },
            max_width: {
              type: "integer",
              exclusiveMinimum: 0,
            },
            max_height: {
              type: "integer",
              exclusiveMinimum: 0,
            },
            max_base64_bytes: {
              type: "integer",
              exclusiveMinimum: 0,
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    tool_output: {
      type: "object",
      properties: {
        max_lines: {
          type: "integer",
          exclusiveMinimum: 0,
        },
        max_bytes: {
          type: "integer",
          exclusiveMinimum: 0,
        },
      },
      additionalProperties: false,
    },
    mcp: {
      type: "object",
      properties: {
        timeout: {
          type: "object",
          properties: {
            startup: {
              type: "integer",
              exclusiveMinimum: 0,
            },
            catalog: {
              type: "integer",
              exclusiveMinimum: 0,
            },
            execution: {
              type: "integer",
              exclusiveMinimum: 0,
            },
          },
          additionalProperties: false,
        },
        servers: {
          type: "object",
          additionalProperties: {
            anyOf: [
              {
                $ref: "#/$defs/Mcp.LocalConfigEncoded",
              },
              {
                $ref: "#/$defs/Mcp.RemoteConfigEncoded",
              },
            ],
          },
        },
      },
      additionalProperties: {
        anyOf: [
          {
            anyOf: [
              {
                $ref: "#/$defs/McpLocalConfig",
              },
              {
                $ref: "#/$defs/McpRemoteConfig",
              },
            ],
          },
          {
            type: "object",
            properties: {
              enabled: {
                type: "boolean",
              },
            },
            required: ["enabled"],
            additionalProperties: false,
          },
        ],
      },
    },
    compaction: {
      type: "object",
      properties: {
        auto: {
          type: "boolean",
        },
        keep: {
          type: "object",
          properties: {
            tokens: {
              type: "integer",
              minimum: 0,
            },
          },
          additionalProperties: false,
        },
        buffer: {
          type: "integer",
          minimum: 0,
        },
        prune: {
          type: "boolean",
        },
        tail_turns: {
          minimum: 0,
          type: "integer",
          maximum: 9007199254740991,
        },
        preserve_recent_tokens: {
          minimum: 0,
          type: "integer",
          maximum: 9007199254740991,
        },
        reserved: {
          minimum: 0,
          type: "integer",
          maximum: 9007199254740991,
        },
      },
      additionalProperties: false,
    },
    skills: {
      anyOf: [
        {
          type: "array",
          items: {
            type: "string",
          },
        },
        {
          type: "object",
          properties: {
            paths: {
              type: "array",
              items: {
                type: "string",
              },
            },
            urls: {
              type: "array",
              items: {
                type: "string",
              },
            },
          },
          additionalProperties: false,
        },
      ],
    },
    commands: {
      type: "object",
      additionalProperties: {
        $ref: "#/$defs/Config.CommandEncoded",
      },
    },
    instructions: {
      type: "array",
      items: {
        type: "string",
      },
    },
    references: {
      type: "object",
      additionalProperties: {
        anyOf: [
          {
            type: "string",
          },
          {
            $ref: "#/$defs/Config.Reference.GitEncoded",
          },
          {
            $ref: "#/$defs/Config.Reference.LocalEncoded",
          },
        ],
      },
      properties: {},
    },
    websearch: {
      anyOf: [
        {
          type: "boolean",
          enum: [false],
        },
        {
          $ref: "#/$defs/ConfigWebSearch.InfoEncoded",
        },
      ],
    },
    plugins: {
      type: "array",
      items: {
        anyOf: [
          {
            type: "string",
          },
          {
            $ref: "#/$defs/Config.Plugin.EntryEncoded",
          },
        ],
      },
    },
    worktree: {
      $ref: "#/$defs/Config.Worktree",
    },
    warming: {
      anyOf: [
        {
          type: "boolean",
        },
        {
          $ref: "#/$defs/Config.WarmingEncoded",
        },
      ],
    },
    providers: {
      type: "object",
      additionalProperties: {
        $ref: "#/$defs/Config.ProviderEncoded",
      },
    },
    experimental: {
      type: "object",
      properties: {
        portable_shell_scanner: {
          type: "boolean",
        },
        todo: {
          type: "boolean",
        },
        subagent_depth: {
          type: "integer",
          minimum: 0,
        },
        location_idle_timeout: {
          anyOf: [
            {
              type: "string",
            },
            {
              type: "boolean",
              enum: [false],
            },
          ],
        },
        policies: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: {
                type: "string",
                enum: ["provider.use", "tool.use", "integration.use"],
              },
              resource: {
                type: "string",
              },
              effect: {
                type: "string",
                enum: ["allow", "deny"],
              },
            },
            required: ["action", "resource", "effect"],
            additionalProperties: false,
          },
        },
        disable_paste_summary: {
          type: "boolean",
        },
        batch_tool: {
          type: "boolean",
        },
        openTelemetry: {
          type: "boolean",
        },
        primary_tools: {
          type: "array",
          items: {
            type: "string",
          },
        },
        continue_loop_on_deny: {
          type: "boolean",
        },
        mcp_timeout: {
          exclusiveMinimum: 0,
          type: "integer",
          maximum: 9007199254740991,
        },
      },
      additionalProperties: false,
    },
    logLevel: {
      $ref: "#/$defs/LogLevel",
    },
    server: {
      $ref: "#/$defs/ServerConfig",
    },
    command: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          template: {
            type: "string",
          },
          agent: {
            type: "string",
          },
          model: {
            type: "string",
            $ref: "https://models.dev/model-schema.json#/$defs/Model",
          },
          variant: {
            type: "string",
          },
          subtask: {
            type: "boolean",
          },
        },
        required: ["template"],
        additionalProperties: false,
      },
    },
    reference: {
      type: "object",
      additionalProperties: {
        anyOf: [
          {
            type: "string",
          },
          {
            $ref: "#/$defs/ConfigV2.Reference.Git",
          },
          {
            $ref: "#/$defs/ConfigV2.Reference.Local",
          },
        ],
      },
    },
    snapshot: {
      type: "boolean",
    },
    plugin: {
      type: "array",
      items: {
        anyOf: [
          {
            type: "string",
          },
          {
            type: "array",
            prefixItems: [
              {
                type: "string",
              },
              {
                type: "object",
              },
            ],
            maxItems: 2,
            minItems: 2,
          },
        ],
      },
    },
    autoshare: {
      type: "boolean",
    },
    autoupdate: {
      anyOf: [
        {
          type: "boolean",
        },
        {
          type: "string",
          enum: ["notify"],
        },
      ],
    },
    disabled_providers: {
      type: "array",
      items: {
        type: "string",
      },
    },
    enabled_providers: {
      type: "array",
      items: {
        type: "string",
      },
    },
    small_model: {
      type: "string",
      $ref: "https://models.dev/model-schema.json#/$defs/Model",
    },
    subagent_depth: {
      minimum: 0,
      type: "integer",
      maximum: 9007199254740991,
    },
    mode: {
      type: "object",
      properties: {
        build: {
          $ref: "#/$defs/AgentConfig",
        },
        plan: {
          $ref: "#/$defs/AgentConfig",
        },
      },
      additionalProperties: {
        $ref: "#/$defs/AgentConfig",
      },
    },
    agent: {
      type: "object",
      properties: {
        plan: {
          $ref: "#/$defs/AgentConfig",
        },
        build: {
          $ref: "#/$defs/AgentConfig",
        },
        general: {
          $ref: "#/$defs/AgentConfig",
        },
        explore: {
          $ref: "#/$defs/AgentConfig",
        },
        summary: {
          $ref: "#/$defs/AgentConfig",
        },
        compaction: {
          $ref: "#/$defs/AgentConfig",
        },
      },
      additionalProperties: {
        $ref: "#/$defs/AgentConfig",
      },
    },
    provider: {
      type: "object",
      additionalProperties: {
        $ref: "#/$defs/ProviderConfig",
      },
    },
    layout: {
      $ref: "#/$defs/LayoutConfig",
    },
    permission: {
      $ref: "#/$defs/PermissionConfig",
    },
    tools: {
      type: "object",
      additionalProperties: {
        type: "boolean",
      },
    },
    attachment: {
      $ref: "#/$defs/AttachmentConfig",
    },
  },
  additionalProperties: false,
  $defs: {
    LogLevel: {
      type: "string",
      enum: ["DEBUG", "INFO", "WARN", "ERROR"],
    },
    ServerConfig: {
      type: "object",
      properties: {
        port: {
          exclusiveMinimum: 0,
          type: "integer",
          maximum: 9007199254740991,
        },
        hostname: {
          type: "string",
        },
        mdns: {
          type: "boolean",
        },
        mdnsDomain: {
          type: "string",
        },
        cors: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      additionalProperties: false,
    },
    "ConfigV2.Reference.Git": {
      type: "object",
      properties: {
        repository: {
          type: "string",
        },
        branch: {
          type: "string",
        },
        hidden: {
          type: "boolean",
        },
      },
      required: ["repository"],
      additionalProperties: false,
    },
    "ConfigV2.Reference.Local": {
      type: "object",
      properties: {
        path: {
          type: "string",
        },
        hidden: {
          type: "boolean",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    PermissionActionConfig: {
      type: "string",
      enum: ["ask", "allow", "deny"],
    },
    PermissionObjectConfig: {
      type: "object",
      additionalProperties: {
        $ref: "#/$defs/PermissionActionConfig",
      },
    },
    PermissionRuleConfig: {
      anyOf: [
        {
          $ref: "#/$defs/PermissionActionConfig",
        },
        {
          $ref: "#/$defs/PermissionObjectConfig",
        },
      ],
    },
    PermissionConfig: {
      anyOf: [
        {
          $ref: "#/$defs/PermissionActionConfig",
        },
        {
          type: "object",
          properties: {
            read: {
              $ref: "#/$defs/PermissionRuleConfig",
            },
            edit: {
              $ref: "#/$defs/PermissionRuleConfig",
            },
            glob: {
              $ref: "#/$defs/PermissionRuleConfig",
            },
            grep: {
              $ref: "#/$defs/PermissionRuleConfig",
            },
            list: {
              $ref: "#/$defs/PermissionRuleConfig",
            },
            bash: {
              $ref: "#/$defs/PermissionRuleConfig",
            },
            task: {
              $ref: "#/$defs/PermissionRuleConfig",
            },
            external_directory: {
              $ref: "#/$defs/PermissionRuleConfig",
            },
            todowrite: {
              $ref: "#/$defs/PermissionActionConfig",
            },
            question: {
              $ref: "#/$defs/PermissionActionConfig",
            },
            webfetch: {
              $ref: "#/$defs/PermissionActionConfig",
            },
            websearch: {
              $ref: "#/$defs/PermissionActionConfig",
            },
            lsp: {
              $ref: "#/$defs/PermissionRuleConfig",
            },
            doom_loop: {
              $ref: "#/$defs/PermissionActionConfig",
            },
            skill: {
              $ref: "#/$defs/PermissionRuleConfig",
            },
          },
          additionalProperties: {
            $ref: "#/$defs/PermissionRuleConfig",
          },
        },
      ],
    },
    AgentConfig: {
      type: "object",
      properties: {
        model: {
          type: "string",
          $ref: "https://models.dev/model-schema.json#/$defs/Model",
        },
        variant: {
          type: "string",
        },
        temperature: {
          type: "number",
        },
        top_p: {
          type: "number",
        },
        prompt: {
          type: "string",
        },
        tools: {
          type: "object",
          additionalProperties: {
            type: "boolean",
          },
        },
        disable: {
          type: "boolean",
        },
        mode: {
          type: "string",
          enum: ["subagent", "primary", "all"],
        },
        hidden: {
          type: "boolean",
        },
        options: {
          type: "object",
        },
        color: {
          anyOf: [
            {
              pattern: "^#[0-9a-fA-F]{6}$",
              type: "string",
            },
            {
              type: "string",
              enum: ["primary", "secondary", "accent", "success", "warning", "error", "info"],
            },
          ],
        },
        steps: {
          exclusiveMinimum: 0,
          type: "integer",
          maximum: 9007199254740991,
        },
        maxSteps: {
          exclusiveMinimum: 0,
          type: "integer",
          maximum: 9007199254740991,
        },
        permission: {
          $ref: "#/$defs/PermissionConfig",
        },
      },
    },
    ProviderConfig: {
      type: "object",
      properties: {
        api: {
          type: "string",
        },
        name: {
          type: "string",
        },
        env: {
          type: "array",
          items: {
            type: "string",
          },
        },
        id: {
          type: "string",
        },
        npm: {
          type: "string",
        },
        whitelist: {
          type: "array",
          items: {
            type: "string",
          },
        },
        blacklist: {
          type: "array",
          items: {
            type: "string",
          },
        },
        options: {
          type: "object",
          properties: {
            apiKey: {
              type: "string",
            },
            baseURL: {
              type: "string",
            },
            enterpriseUrl: {
              type: "string",
            },
            setCacheKey: {
              type: "boolean",
            },
            timeout: {
              anyOf: [
                {
                  exclusiveMinimum: 0,
                  type: "integer",
                  maximum: 9007199254740991,
                },
                {
                  type: "boolean",
                  enum: [false],
                },
              ],
            },
            headerTimeout: {
              anyOf: [
                {
                  exclusiveMinimum: 0,
                  type: "integer",
                  maximum: 9007199254740991,
                },
                {
                  type: "boolean",
                  enum: [false],
                },
              ],
            },
            chunkTimeout: {
              anyOf: [
                {
                  exclusiveMinimum: 0,
                  type: "integer",
                  maximum: 9007199254740991,
                },
                {
                  type: "boolean",
                  enum: [false],
                },
              ],
            },
          },
        },
        models: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              id: {
                type: "string",
              },
              name: {
                type: "string",
              },
              family: {
                type: "string",
              },
              release_date: {
                type: "string",
              },
              attachment: {
                type: "boolean",
              },
              reasoning: {
                type: "boolean",
              },
              temperature: {
                type: "boolean",
              },
              tool_call: {
                type: "boolean",
              },
              interleaved: {
                anyOf: [
                  {
                    type: "boolean",
                  },
                  {
                    anyOf: [
                      {
                        type: "string",
                        enum: ["reasoning", "reasoning_content", "reasoning_text"],
                      },
                      {
                        type: "string",
                      },
                    ],
                  },
                  {
                    type: "object",
                    properties: {
                      field: {
                        anyOf: [
                          {
                            type: "string",
                            enum: ["reasoning", "reasoning_content", "reasoning_text"],
                          },
                          {
                            type: "string",
                          },
                        ],
                      },
                    },
                    required: ["field"],
                    additionalProperties: false,
                  },
                ],
              },
              cost: {
                type: "object",
                properties: {
                  input: {
                    type: "number",
                  },
                  output: {
                    type: "number",
                  },
                  cache_read: {
                    type: "number",
                  },
                  cache_write: {
                    type: "number",
                  },
                  context_over_200k: {
                    type: "object",
                    properties: {
                      input: {
                        type: "number",
                      },
                      output: {
                        type: "number",
                      },
                      cache_read: {
                        type: "number",
                      },
                      cache_write: {
                        type: "number",
                      },
                    },
                    required: ["input", "output"],
                    additionalProperties: false,
                  },
                },
                required: ["input", "output"],
                additionalProperties: false,
              },
              limit: {
                type: "object",
                properties: {
                  context: {
                    type: "number",
                  },
                  input: {
                    type: "number",
                  },
                  output: {
                    type: "number",
                  },
                },
                required: ["context", "output"],
                additionalProperties: false,
              },
              modalities: {
                type: "object",
                properties: {
                  input: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: ["text", "audio", "image", "video", "pdf"],
                    },
                  },
                  output: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: ["text", "audio", "image", "video", "pdf"],
                    },
                  },
                },
                additionalProperties: false,
              },
              experimental: {
                type: "boolean",
              },
              status: {
                type: "string",
                enum: ["alpha", "beta", "deprecated", "active"],
              },
              provider: {
                type: "object",
                properties: {
                  npm: {
                    type: "string",
                  },
                  api: {
                    type: "string",
                  },
                },
                additionalProperties: false,
              },
              options: {
                type: "object",
              },
              headers: {
                type: "object",
                additionalProperties: {
                  type: "string",
                },
              },
              variants: {
                type: "object",
                additionalProperties: {
                  type: "object",
                  properties: {
                    disabled: {
                      type: "boolean",
                    },
                  },
                },
              },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    McpLocalConfig: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["local"],
        },
        command: {
          type: "array",
          items: {
            type: "string",
          },
        },
        cwd: {
          type: "string",
        },
        environment: {
          type: "object",
          additionalProperties: {
            type: "string",
          },
        },
        enabled: {
          type: "boolean",
        },
        timeout: {
          exclusiveMinimum: 0,
          type: "integer",
          maximum: 9007199254740991,
        },
      },
      required: ["type", "command"],
      additionalProperties: false,
    },
    McpOAuthConfig: {
      type: "object",
      properties: {
        clientId: {
          type: "string",
        },
        clientSecret: {
          type: "string",
        },
        scope: {
          type: "string",
        },
        callbackPort: {
          minimum: 1,
          maximum: 65535,
          type: "integer",
        },
        redirectUri: {
          type: "string",
        },
      },
      additionalProperties: false,
    },
    McpRemoteConfig: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["remote"],
        },
        url: {
          type: "string",
        },
        enabled: {
          type: "boolean",
        },
        headers: {
          type: "object",
          additionalProperties: {
            type: "string",
          },
        },
        oauth: {
          anyOf: [
            {
              $ref: "#/$defs/McpOAuthConfig",
            },
            {
              type: "boolean",
              enum: [false],
            },
          ],
        },
        timeout: {
          exclusiveMinimum: 0,
          type: "integer",
          maximum: 9007199254740991,
        },
      },
      required: ["type", "url"],
      additionalProperties: false,
    },
    LayoutConfig: {
      type: "string",
      enum: ["auto", "stretch"],
    },
    ImageAttachmentConfig: {
      type: "object",
      properties: {
        auto_resize: {
          type: "boolean",
        },
        max_width: {
          exclusiveMinimum: 0,
          type: "integer",
          maximum: 9007199254740991,
        },
        max_height: {
          exclusiveMinimum: 0,
          type: "integer",
          maximum: 9007199254740991,
        },
        max_base64_bytes: {
          exclusiveMinimum: 0,
          type: "integer",
          maximum: 9007199254740991,
        },
      },
      additionalProperties: false,
    },
    AttachmentConfig: {
      type: "object",
      properties: {
        image: {
          $ref: "#/$defs/ImageAttachmentConfig",
        },
      },
      additionalProperties: false,
    },
    "Policy.Effect": {
      type: "string",
      enum: ["allow", "deny"],
    },
    "ConfigV2.Experimental.Policy": {
      type: "object",
      properties: {
        action: {
          anyOf: [
            {
              anyOf: [
                {
                  type: "string",
                  enum: ["provider.use"],
                },
              ],
            },
          ],
        },
        effect: {
          $ref: "#/$defs/Policy.Effect",
        },
        resource: {
          type: "string",
        },
      },
      required: ["action", "effect", "resource"],
      additionalProperties: false,
    },
    "Permission.Effect": {
      type: "string",
      enum: ["allow", "deny", "ask"],
    },
    "Permission.Rule": {
      type: "object",
      properties: {
        action: {
          type: "string",
        },
        resource: {
          type: "string",
        },
        effect: {
          $ref: "#/$defs/Permission.Effect",
        },
      },
      required: ["action", "resource", "effect"],
      additionalProperties: false,
    },
    "Permission.Ruleset": {
      type: "array",
      items: {
        $ref: "#/$defs/Permission.Rule",
      },
    },
    "Config.AgentEncoded": {
      type: "object",
      properties: {
        model: {
          anyOf: [
            {
              type: "string",
              pattern: "^[^/#]+\\/[^#]+(?:#[^#]+)?$",
            },
            {
              type: "object",
              properties: {
                providerID: {
                  type: "string",
                  pattern: "^[^/#]+$",
                },
                model: {
                  type: "string",
                  pattern: "^[^#]+$",
                },
                variant: {
                  type: "string",
                  pattern: "^[^#]+$",
                },
              },
              required: ["providerID", "model"],
              additionalProperties: false,
            },
          ],
        },
        request: {
          type: "object",
          properties: {
            headers: {
              type: "object",
              additionalProperties: {
                type: "string",
              },
            },
            body: {
              type: "object",
            },
          },
          additionalProperties: false,
        },
        system: {
          type: "string",
        },
        mode: {
          type: "string",
          enum: ["subagent", "primary", "all"],
        },
        hidden: {
          type: "boolean",
        },
        color: {
          type: "string",
          pattern: "^#[0-9a-fA-F]{6}$",
        },
        steps: {
          type: "integer",
          exclusiveMinimum: 0,
        },
        disabled: {
          type: "boolean",
        },
        permissions: {
          $ref: "#/$defs/Permission.Ruleset",
        },
      },
      additionalProperties: false,
    },
    "Config.Formatter.EntryEncoded": {
      type: "object",
      properties: {
        disabled: {
          type: "boolean",
        },
        command: {
          type: "array",
          items: {
            type: "string",
          },
        },
        environment: {
          type: "object",
          additionalProperties: {
            type: "string",
          },
        },
        extensions: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      additionalProperties: false,
    },
    "Config.LSP.ServerEncoded": {
      type: "object",
      properties: {
        command: {
          type: "array",
          items: {
            type: "string",
          },
        },
        extensions: {
          type: "array",
          items: {
            type: "string",
          },
        },
        disabled: {
          type: "boolean",
        },
        env: {
          type: "object",
          additionalProperties: {
            type: "string",
          },
        },
        initialization: {
          type: "object",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
    "Mcp.Protocol": {
      type: "string",
      enum: ["legacy", "auto", "2026-07-28"],
    },
    "Mcp.LocalConfigEncoded": {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["local"],
        },
        command: {
          type: "array",
          items: {
            type: "string",
          },
        },
        cwd: {
          type: "string",
        },
        environment: {
          type: "object",
          additionalProperties: {
            type: "string",
          },
        },
        disabled: {
          type: "boolean",
        },
        codemode: {
          type: "boolean",
        },
        timeout: {
          type: "object",
          properties: {
            startup: {
              type: "integer",
              exclusiveMinimum: 0,
            },
            catalog: {
              type: "integer",
              exclusiveMinimum: 0,
            },
            execution: {
              type: "integer",
              exclusiveMinimum: 0,
            },
          },
          additionalProperties: false,
        },
        protocol: {
          $ref: "#/$defs/Mcp.Protocol",
        },
      },
      required: ["type", "command"],
      additionalProperties: false,
    },
    "Mcp.OAuthConfigEncoded": {
      type: "object",
      properties: {
        client_id: {
          type: "string",
        },
        client_secret: {
          type: "string",
        },
        scope: {
          type: "string",
        },
        callback_port: {
          type: "integer",
          minimum: 1,
          maximum: 65535,
        },
        redirect_uri: {
          type: "string",
        },
        auth_server_metadata_url: {
          type: "string",
        },
      },
      additionalProperties: false,
    },
    "Mcp.RemoteConfigEncoded": {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["remote"],
        },
        url: {
          type: "string",
        },
        headers: {
          type: "object",
          additionalProperties: {
            type: "string",
          },
        },
        oauth: {
          anyOf: [
            {
              $ref: "#/$defs/Mcp.OAuthConfigEncoded",
            },
            {
              type: "boolean",
              enum: [false],
            },
          ],
        },
        disabled: {
          type: "boolean",
        },
        codemode: {
          type: "boolean",
        },
        timeout: {
          type: "object",
          properties: {
            startup: {
              type: "integer",
              exclusiveMinimum: 0,
            },
            catalog: {
              type: "integer",
              exclusiveMinimum: 0,
            },
            execution: {
              type: "integer",
              exclusiveMinimum: 0,
            },
          },
          additionalProperties: false,
        },
        protocol: {
          $ref: "#/$defs/Mcp.Protocol",
        },
      },
      required: ["type", "url"],
      additionalProperties: false,
    },
    "Config.CommandEncoded": {
      type: "object",
      properties: {
        template: {
          type: "string",
        },
        agent: {
          type: "string",
        },
        model: {
          anyOf: [
            {
              type: "string",
              pattern: "^[^/#]+\\/[^#]+(?:#[^#]+)?$",
            },
            {
              type: "object",
              properties: {
                providerID: {
                  type: "string",
                  pattern: "^[^/#]+$",
                },
                model: {
                  type: "string",
                  pattern: "^[^#]+$",
                },
                variant: {
                  type: "string",
                  pattern: "^[^#]+$",
                },
              },
              required: ["providerID", "model"],
              additionalProperties: false,
            },
          ],
        },
        subagent: {
          type: "boolean",
        },
        subtask: {
          type: "boolean",
        },
      },
      required: ["template"],
      additionalProperties: false,
    },
    "Config.Reference.GitEncoded": {
      type: "object",
      properties: {
        repository: {
          type: "string",
        },
        branch: {
          type: "string",
        },
        hidden: {
          type: "boolean",
        },
      },
      required: ["repository"],
      additionalProperties: false,
    },
    "Config.Reference.LocalEncoded": {
      type: "object",
      properties: {
        path: {
          type: "string",
        },
        hidden: {
          type: "boolean",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    "WebSearch.ID": {
      type: "string",
    },
    "ConfigWebSearch.InfoEncoded": {
      type: "object",
      properties: {
        provider: {
          anyOf: [
            {
              type: "string",
              enum: ["random"],
            },
            {
              $ref: "#/$defs/WebSearch.ID",
            },
          ],
        },
      },
      required: ["provider"],
      additionalProperties: false,
    },
    "Config.Plugin.EntryEncoded": {
      type: "object",
      properties: {
        package: {
          type: "string",
        },
        options: {
          type: "object",
        },
      },
      required: ["package"],
      additionalProperties: false,
    },
    "Config.Worktree": {
      type: "object",
      properties: {
        directory: {
          type: "string",
        },
      },
      required: ["directory"],
      additionalProperties: false,
    },
    "Config.WarmingEncoded": {
      type: "object",
      properties: {
        prompt: {
          type: "string",
        },
        interval: {
          type: "string",
        },
        duration: {
          type: "string",
        },
      },
      additionalProperties: false,
    },
    "Provider.ID": {
      type: "string",
    },
    "Model.ReasoningField": {
      anyOf: [
        {
          type: "string",
          enum: ["reasoning", "reasoning_content", "reasoning_text"],
        },
        {
          type: "string",
        },
      ],
    },
    "Model.MaxTokensField": {
      type: "string",
      enum: ["max_completion_tokens", "max_tokens"],
    },
    "Model.CacheFormat": {
      type: "string",
      enum: ["anthropic", "alibaba"],
    },
    "Provider.Compatibility": {
      type: "object",
      properties: {
        reasoningField: {
          $ref: "#/$defs/Model.ReasoningField",
        },
        requireReasoning: {
          type: "boolean",
        },
        maxTokensField: {
          $ref: "#/$defs/Model.MaxTokensField",
        },
        requireFinishReason: {
          type: "boolean",
        },
        requireAssistantAfterTool: {
          type: "boolean",
        },
        supportsPromptCacheKey: {
          type: "boolean",
        },
        streamUsage: {
          type: "boolean",
        },
        cacheFormat: {
          $ref: "#/$defs/Model.CacheFormat",
        },
      },
      additionalProperties: false,
    },
    "Provider.Compaction": {
      anyOf: [
        {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["summary"],
            },
          },
          required: ["type"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["native"],
            },
          },
          required: ["type"],
          additionalProperties: false,
        },
      ],
    },
    "Provider.Transport": {
      type: "string",
      enum: ["http", "websocket"],
    },
    "Provider.Encoding": {
      type: "string",
      enum: ["zstd", "gzip", "none"],
    },
    "Config.Provider.Settings": {
      type: "object",
      properties: {
        timeout: {
          anyOf: [
            {
              type: "number",
            },
            {
              type: "boolean",
              enum: [false],
            },
          ],
        },
        headerTimeout: {
          anyOf: [
            {
              type: "number",
            },
            {
              type: "boolean",
              enum: [false],
            },
          ],
        },
        chunkTimeout: {
          anyOf: [
            {
              type: "number",
            },
            {
              type: "boolean",
              enum: [false],
            },
          ],
        },
        compaction: {
          $ref: "#/$defs/Provider.Compaction",
        },
        transport: {
          $ref: "#/$defs/Provider.Transport",
        },
        encoding: {
          $ref: "#/$defs/Provider.Encoding",
        },
      },
      allOf: [
        {
          type: "object",
          additionalProperties: {
            anyOf: [
              {},
              {
                type: "null",
              },
            ],
          },
        },
      ],
    },
    "Model.Compatibility": {
      type: "object",
      properties: {
        reasoningField: {
          $ref: "#/$defs/Model.ReasoningField",
        },
        requireReasoning: {
          type: "boolean",
        },
        maxTokensField: {
          $ref: "#/$defs/Model.MaxTokensField",
        },
        requireFinishReason: {
          type: "boolean",
        },
        requireAssistantAfterTool: {
          type: "boolean",
        },
        supportsPromptCacheKey: {
          type: "boolean",
        },
        streamUsage: {
          type: "boolean",
        },
        cacheFormat: {
          $ref: "#/$defs/Model.CacheFormat",
        },
        supportsThinkingBlockBinding: {
          type: "boolean",
        },
        supportsEffortUpdates: {
          type: "boolean",
        },
      },
      additionalProperties: false,
    },
    "Config.Model.Settings": {
      type: "object",
      properties: {
        compaction: {
          $ref: "#/$defs/Provider.Compaction",
        },
        encoding: {
          $ref: "#/$defs/Provider.Encoding",
        },
      },
      allOf: [
        {
          type: "object",
          additionalProperties: {
            anyOf: [
              {},
              {
                type: "null",
              },
            ],
          },
        },
      ],
    },
    "Config.Model.Reasoning": {
      anyOf: [
        {
          type: "object",
          properties: {
            supported: {
              type: "boolean",
              enum: [false],
            },
          },
          required: ["supported"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            supported: {
              type: "boolean",
              enum: [true],
            },
            toggle: {
              type: "boolean",
            },
            effort: {
              type: "array",
              items: {
                type: "string",
              },
            },
            budget: {
              type: "object",
              properties: {
                min: {
                  type: "integer",
                },
                max: {
                  type: "integer",
                },
              },
              additionalProperties: false,
            },
          },
          required: ["supported"],
          additionalProperties: false,
        },
      ],
    },
    "Config.Model.Capabilities": {
      type: "object",
      properties: {
        tools: {
          type: "boolean",
        },
        input: {
          type: "array",
          items: {
            type: "string",
          },
        },
        output: {
          type: "array",
          items: {
            type: "string",
          },
        },
        temperature: {
          type: "boolean",
        },
        reasoning: {
          $ref: "#/$defs/Config.Model.Reasoning",
        },
      },
      additionalProperties: false,
    },
    "Money.USDPerMillionTokens": {
      type: "number",
    },
    "Config.Model.CostEncoded": {
      type: "object",
      properties: {
        tier: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["context"],
            },
            size: {
              type: "integer",
            },
          },
          required: ["type", "size"],
          additionalProperties: false,
        },
        input: {
          $ref: "#/$defs/Money.USDPerMillionTokens",
        },
        output: {
          $ref: "#/$defs/Money.USDPerMillionTokens",
        },
        cache: {
          type: "object",
          properties: {
            read: {
              $ref: "#/$defs/Money.USDPerMillionTokens",
            },
            write: {
              $ref: "#/$defs/Money.USDPerMillionTokens",
            },
          },
          additionalProperties: false,
        },
      },
      required: ["input", "output"],
      additionalProperties: false,
    },
    "Config.ModelEncoded": {
      type: "object",
      properties: {
        modelID: {
          type: "string",
        },
        family: {
          type: "string",
        },
        name: {
          type: "string",
        },
        releaseDate: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}(-\\d{2})?$",
        },
        compatibility: {
          $ref: "#/$defs/Model.Compatibility",
        },
        package: {
          type: "string",
        },
        settings: {
          $ref: "#/$defs/Config.Model.Settings",
        },
        headers: {
          type: "object",
          additionalProperties: {
            type: "string",
          },
        },
        body: {
          type: "object",
        },
        capabilities: {
          $ref: "#/$defs/Config.Model.Capabilities",
        },
        variants: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
              },
              settings: {
                $ref: "#/$defs/Config.Model.Settings",
              },
              headers: {
                type: "object",
                additionalProperties: {
                  type: "string",
                },
              },
              body: {
                type: "object",
              },
            },
            required: ["id"],
            additionalProperties: false,
          },
        },
        cost: {
          anyOf: [
            {
              $ref: "#/$defs/Config.Model.CostEncoded",
            },
            {
              type: "array",
              items: {
                $ref: "#/$defs/Config.Model.CostEncoded",
              },
            },
          ],
        },
        disabled: {
          type: "boolean",
        },
        limit: {
          type: "object",
          properties: {
            context: {
              type: "integer",
            },
            input: {
              type: "integer",
            },
            output: {
              type: "integer",
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    "Config.ProviderEncoded": {
      type: "object",
      properties: {
        canonical: {
          $ref: "#/$defs/Provider.ID",
        },
        name: {
          type: "string",
        },
        env: {
          type: "array",
          items: {
            type: "string",
          },
        },
        package: {
          type: "string",
        },
        compatibility: {
          $ref: "#/$defs/Provider.Compatibility",
        },
        settings: {
          $ref: "#/$defs/Config.Provider.Settings",
        },
        headers: {
          type: "object",
          additionalProperties: {
            type: "string",
          },
        },
        body: {
          type: "object",
        },
        models: {
          type: "object",
          additionalProperties: {
            $ref: "#/$defs/Config.ModelEncoded",
          },
        },
      },
      additionalProperties: false,
    },
  },
  allowComments: true,
  allowTrailingCommas: true,
} as const;
