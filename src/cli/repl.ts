import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stderr, stdin, stdout } from "node:process";

import { AgentLoop } from "../agent/loop.js";
import { MessageBus } from "../bus/message-bus.js";
import type { OutboundMessage } from "../bus/events.js";
import { FeishuChannel } from "../channels/feishu.js";
import { CronService } from "../cron/service.js";
import { loadOrCreateConfig, resolveWorkspacePath, getDataDir } from "../config/loader.js";
import { HeartbeatService } from "../heartbeat/service.js";
import { makeProvider } from "../llm/provider-factory.js";
import { syncWorkspaceTemplates } from "../templates/sync.js";

async function main(): Promise<void> {
  const config = await loadOrCreateConfig();
  const workspace = resolveWorkspacePath(config);
  await mkdir(workspace, { recursive: true });
  await syncWorkspaceTemplates(workspace);

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

  let running = true;
  await agent.initMcp();
  const runTask = agent.run();
  await cron.start();
  await heartbeat.start();
  if (feishu.isEnabled) {
    await feishu.start();
    stdout.write("Feishu long connection started (WebSocket)\n");
  }

  const pending = new Map<string, (value: string) => void>();
  const routeOutbound = async (msg: OutboundMessage): Promise<void> => {
    if (msg.channel === "feishu" && feishu.isEnabled) {
      try {
        await feishu.send(msg);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr.write(`Feishu send error: ${message}\n`);
      }
      return;
    }

    const metadata =
      typeof msg.metadata === "object" && msg.metadata !== null
        ? (msg.metadata as Record<string, unknown>)
        : {};
    const messageId = typeof metadata.message_id === "string" ? metadata.message_id : null;
    const isProgress = metadata._progress === true;
    const isToolHint = metadata._tool_hint === true;

    if (messageId && pending.has(messageId)) {
      if (isProgress) {
        if (isToolHint && !config.channels.sendToolHints) {
          return;
        }
        if (!isToolHint && !config.channels.sendProgress) {
          return;
        }
        stdout.write(`  ↳ ${msg.content}\n`);
        return;
      }
      const resolve = pending.get(messageId);
      if (resolve) {
        pending.delete(messageId);
        resolve(msg.content);
      }
      return;
    }

    if (isProgress) {
      return;
    }
    stdout.write(`\nAgent: ${msg.content}\n`);
  };

  const outboundTask = (async () => {
    while (running) {
      const msg = await bus.consumeOutbound(500);
      if (!msg) {
        continue;
      }
      await routeOutbound(msg);
    }
  })();

  const rl = readline.createInterface({ input: stdin, output: stdout });
  stdout.write(`Agent loop ready. Workspace: ${workspace}\nType 'exit' to quit.\n`);

  const sendUserMessage = async (content: string): Promise<string> => {
    const messageId = `cli_${randomUUID().slice(0, 8)}`;
    const responsePromise = new Promise<string>((resolve) => {
      pending.set(messageId, resolve);
    });
    await bus.publishInbound({
      channel: "cli",
      senderId: "user",
      chatId: "direct",
      content,
      metadata: {
        message_id: messageId,
      },
    });
    return responsePromise;
  };

  while (true) {
    const line = (await rl.question("You: ")).trim();
    if (!line) {
      continue;
    }
    if (line.toLowerCase() === "exit") {
      break;
    }

    const response = await sendUserMessage(line);
    stdout.write(`Agent: ${response}\n`);
  }

  running = false;
  rl.close();
  heartbeat.stop();
  cron.stop();
  await feishu.stop();
  agent.stop();
  await Promise.allSettled([runTask, outboundTask]);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`Fatal error: ${message}\n`);
  if (message.includes("No API key configured")) {
    stderr.write(
      "Configure ~/.openintern/config.json -> providers.openaiCompatible.apiKey or providers.anthropicCompatible.apiKey\n",
    );
  }
  process.exitCode = 1;
});
