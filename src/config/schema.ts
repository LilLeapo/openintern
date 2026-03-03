export interface AgentDefaultsConfig {
  workspace: string;
  model: string;
  provider: "auto" | "openaiCompatible" | "anthropicCompatible";
  maxTokens: number;
  temperature: number;
  maxToolIterations: number;
  memoryWindow: number;
  reasoningEffort: string | null;
}

export interface ProviderConfig {
  apiKey: string;
  apiBase: string;
  extraHeaders?: Record<string, string>;
}

export interface AnthropicProviderConfig extends ProviderConfig {
  anthropicVersion: string;
}

export interface ProvidersConfig {
  openaiCompatible: ProviderConfig;
  anthropicCompatible: AnthropicProviderConfig;
}

export interface WebSearchConfig {
  apiKey: string;
  maxResults: number;
}

export interface WebToolsConfig {
  proxy: string | null;
  search: WebSearchConfig;
}

export interface ExecToolConfig {
  timeout: number;
}

export interface ToolsConfig {
  web: WebToolsConfig;
  exec: ExecToolConfig;
  restrictToWorkspace: boolean;
}

export interface ChannelsConfig {
  sendProgress: boolean;
  sendToolHints: boolean;
  feishu: FeishuChannelConfig;
}

export interface HeartbeatConfig {
  enabled: boolean;
  intervalS: number;
}

export interface FeishuChannelConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
  allowFrom: string[];
  webhookPath: string;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

export interface GatewayConfig {
  host: string;
  port: number;
  heartbeat: HeartbeatConfig;
}

export interface MemUConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  agentId: string;
  timeoutMs: number;
  retrieve: boolean;
  memorize: boolean;
  apiStyle: "cloudV3" | "localSimple" | "mem0V1";
  endpoints: {
    memorize?: string;
    retrieve?: string;
    categories?: string;
    status?: string;
  };
}

export interface MemoryConfig {
  memu: MemUConfig;
}

export interface AppConfig {
  agents: {
    defaults: AgentDefaultsConfig;
  };
  providers: ProvidersConfig;
  tools: ToolsConfig;
  memory: MemoryConfig;
  channels: ChannelsConfig;
  gateway: GatewayConfig;
  mcp: McpConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
  agents: {
    defaults: {
      workspace: "~/.openintern/workspace",
      model: "gpt-4o-mini",
      provider: "auto",
      maxTokens: 4096,
      temperature: 0.1,
      maxToolIterations: 40,
      memoryWindow: 100,
      reasoningEffort: null,
    },
  },
  providers: {
    openaiCompatible: {
      apiKey: "",
      apiBase: "https://api.openai.com/v1",
      extraHeaders: {},
    },
    anthropicCompatible: {
      apiKey: "",
      apiBase: "https://api.anthropic.com/v1",
      anthropicVersion: "2023-06-01",
      extraHeaders: {},
    },
  },
  tools: {
    web: {
      proxy: null,
      search: {
        apiKey: "",
        maxResults: 5,
      },
    },
    exec: {
      timeout: 60,
    },
    restrictToWorkspace: false,
  },
  memory: {
    memu: {
      enabled: false,
      apiKey: "",
      baseUrl: "https://api.memu.so",
      agentId: "openintern",
      timeoutMs: 15_000,
      retrieve: true,
      memorize: true,
      apiStyle: "cloudV3",
      endpoints: {},
    },
  },
  channels: {
    sendProgress: true,
    sendToolHints: false,
    feishu: {
      enabled: false,
      appId: "",
      appSecret: "",
      verificationToken: "",
      encryptKey: "",
      allowFrom: [],
      webhookPath: "/feishu/events",
    },
  },
  gateway: {
    host: "0.0.0.0",
    port: 18790,
    heartbeat: {
      enabled: true,
      intervalS: 30 * 60,
    },
  },
  mcp: {
    servers: {},
  },
};
