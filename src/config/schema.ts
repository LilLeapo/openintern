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

export interface RoleConfig {
  systemPrompt: string;
  allowedTools: string[];
  memoryScope: "chat" | "papers";
  maxIterations?: number;
  workspaceIsolation?: boolean;
}

export interface SubagentConcurrencyConfig {
  maxConcurrent: number;
}

export interface AgentTraceConfig {
  enabled: boolean;
  level: "basic" | "verbose";
  includeSubagents: boolean;
  mirrorToProgress: boolean;
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
  reactEmoji: string;
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
  scopes: {
    chat: string;
    papers: string;
  };
  timeoutMs: number;
  retrieve: boolean;
  memorize: boolean;
  memorizeMode: "auto" | "tool";
  apiStyle: "cloudV3" | "localSimple" | "mem0V1";
  endpoints: {
    memorize?: string;
    retrieve?: string;
    categories?: string;
    status?: string;
    clear?: string;
  };
}

export type MemoryOwnerType = "principal" | "conversation" | "knowledgeBase";

export interface MemoryIsolationConfig {
  tenantId: string;
  scopeOwners: {
    chat: MemoryOwnerType;
    papers: MemoryOwnerType;
  };
}

export interface MemoryConfig {
  memu: MemUConfig;
  isolation: MemoryIsolationConfig;
}

export interface AppConfig {
  agents: {
    defaults: AgentDefaultsConfig;
    subagentConcurrency: SubagentConcurrencyConfig;
    trace: AgentTraceConfig;
  };
  roles: Record<string, RoleConfig>;
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
    subagentConcurrency: {
      maxConcurrent: 3,
    },
    trace: {
      enabled: false,
      level: "basic",
      includeSubagents: true,
      mirrorToProgress: true,
    },
  },
  roles: {
    researcher: {
      systemPrompt:
        "You are a research assistant. Search the web for academic papers, summarize findings, and save important references to memory.",
      allowedTools: ["web_search", "web_fetch", "memory_save", "memory_retrieve"],
      memoryScope: "papers",
      maxIterations: 20,
      workspaceIsolation: false,
    },
    scientist: {
      systemPrompt:
        "You are a scientist subagent. Analyze data, write code, and produce structured reports.",
      allowedTools: [
        "read_file",
        "write_file",
        "edit_file",
        "list_dir",
        "exec",
        "memory_save",
        "memory_retrieve",
      ],
      memoryScope: "chat",
      maxIterations: 15,
      workspaceIsolation: true,
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
    isolation: {
      tenantId: "default",
      scopeOwners: {
        chat: "principal",
        papers: "conversation",
      },
    },
    memu: {
      enabled: false,
      apiKey: "",
      baseUrl: "https://api.memu.so",
      agentId: "openintern",
      scopes: {
        chat: "chat",
        papers: "papers",
      },
      timeoutMs: 15_000,
      retrieve: true,
      memorize: true,
      memorizeMode: "tool",
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
      reactEmoji: "THUMBSUP",
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
