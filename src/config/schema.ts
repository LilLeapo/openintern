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
}

export interface HeartbeatConfig {
  enabled: boolean;
  intervalS: number;
}

export interface GatewayConfig {
  heartbeat: HeartbeatConfig;
}

export interface AppConfig {
  agents: {
    defaults: AgentDefaultsConfig;
  };
  providers: ProvidersConfig;
  tools: ToolsConfig;
  channels: ChannelsConfig;
  gateway: GatewayConfig;
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
  channels: {
    sendProgress: true,
    sendToolHints: false,
  },
  gateway: {
    heartbeat: {
      enabled: true,
      intervalS: 30 * 60,
    },
  },
};
