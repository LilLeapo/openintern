import { mkdir } from "node:fs/promises";
import path from "node:path";

import { AgentLoop } from "../agent/loop.js";
import { MessageBus } from "../bus/message-bus.js";
import { FeishuChannel } from "../channels/feishu.js";
import { loadOrCreateConfig, resolveWorkspacePath, getDataDir } from "../config/loader.js";
import { CronService } from "../cron/service.js";
import { HeartbeatService } from "../heartbeat/service.js";
import { makeProvider } from "../llm/provider-factory.js";
import { syncWorkspaceTemplates } from "../templates/sync.js";

export interface AppRuntime {
  config: Awaited<ReturnType<typeof loadOrCreateConfig>>;
  workspace: string;
  bus: MessageBus;
  cron: CronService;
  heartbeat: HeartbeatService;
  feishu: FeishuChannel;
  agent: AgentLoop;
}

export async function createAppRuntime(): Promise<AppRuntime> {
  const config = await loadOrCreateConfig();
  const workspace = resolveWorkspacePath(config);
  await mkdir(workspace, { recursive: true });
  await syncWorkspaceTemplates(workspace, config.memory.mode);

  const bus = new MessageBus();
  const provider = makeProvider(config);
  const cronStorePath = path.join(getDataDir(), "cron", "jobs.json");
  const cron = new CronService(cronStorePath);
  const feishu = new FeishuChannel({
    config: config.channels.feishu,
    bus,
  });
  const agent = new AgentLoop({
    bus,
    provider,
    workspace,
    model: config.agents.defaults.model,
    maxIterations: config.agents.defaults.maxToolIterations,
    maxTokens: config.agents.defaults.maxTokens,
    temperature: config.agents.defaults.temperature,
    memoryWindow: config.agents.defaults.memoryWindow,
    reasoningEffort: config.agents.defaults.reasoningEffort,
    restrictToWorkspace: config.tools.restrictToWorkspace,
    execTimeoutSeconds: config.tools.exec.timeout,
    webSearchApiKey: config.tools.web.search.apiKey,
    webSearchMaxResults: config.tools.web.search.maxResults,
    webProxy: config.tools.web.proxy,
    cronService: cron,
    channelsConfig: config.channels,
    mcpConfig: config.mcp,
    memoryConfig: config.memory,
    appConfig: config,
  });

  cron.onJob = async (job) => {
    const reminder = `[Scheduled Task] Timer finished.

Task '${job.name}' has been triggered.
Scheduled instruction: ${job.payload.message}`;
    await bus.publishInbound({
      channel: job.payload.channel ?? "cli",
      senderId: "cron",
      chatId: job.payload.to ?? "direct",
      content: reminder,
      metadata: {
        message_id: `cron_${job.id}_${Date.now()}`,
      },
      sessionKeyOverride: `cron:${job.id}`,
    });
    return null;
  };

  const heartbeat = new HeartbeatService({
    workspace,
    provider,
    model: config.agents.defaults.model,
    intervalS: config.gateway.heartbeat.intervalS,
    enabled: config.gateway.heartbeat.enabled,
    onExecute: async (tasks) =>
      agent.processDirect({
        content: tasks,
        sessionKey: "heartbeat",
        channel: "cli",
        chatId: "direct",
        onProgress: async () => {
          // Heartbeat progress is intentionally suppressed in CLI.
        },
      }),
    onNotify: async (response) => {
      await bus.publishOutbound({
        channel: "cli",
        chatId: "direct",
        content: response,
        metadata: {
          _heartbeat: true,
        },
      });
    },
  });

  return {
    config,
    workspace,
    bus,
    cron,
    heartbeat,
    feishu,
    agent,
  };
}
