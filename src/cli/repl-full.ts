import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stderr, stdin, stdout } from "node:process";

import { SdkAgent } from "../agent/sdk-agent.js";
import { MessageBus } from "../bus/message-bus.js";
import type { OutboundMessage } from "../bus/events.js";
import { FeishuChannel } from "../channels/feishu.js";
import { CronService } from "../cron/service.js";
import { loadOrCreateConfig, resolveWorkspacePath, getDataDir } from "../config/loader.js";
import { HeartbeatService } from "../heartbeat/service.js";
import { syncWorkspaceTemplates } from "../templates/sync.js";

async function main(): Promise<void> {
  const config = await loadOrCreateConfig();
  const workspace = resolveWorkspacePath(config);
  await mkdir(workspace, { recursive: true });
  await syncWorkspaceTemplates(workspace);

  const bus = new MessageBus();

  const agent = new SdkAgent({
    bus,
    workspace,
    apiKey: "", // SDK 会从 ~/.claude/settings.json 读取
    model: config.agents.defaults.model,
    maxIterations: config.agents.defaults.maxToolIterations,
    maxTokens: config.agents.defaults.maxTokens,
    temperature: config.agents.defaults.temperature,
    restrictToWorkspace: config.tools.restrictToWorkspace,
    mcpConfig: config.mcp,
    memoryConfig: config.memory,
    channelsConfig: config.channels,
  });

  // 定时任务服务
  const cronStorePath = path.join(getDataDir(), "cron", "jobs.json");
  const cron = new CronService(cronStorePath);

  cron.onJob = async (job) => {
    const reminder = `[定时任务] 计时器已完成。

任务 '${job.name}' 已触发。
计划指令: ${job.payload.message}`;
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

  // 飞书集成
  const feishu = new FeishuChannel({
    config: config.channels.feishu,
    bus,
    host: config.gateway.host,
    port: config.gateway.port,
  });

  let running = true;
  const runTask = agent.run();
  await cron.start();

  if (feishu.isEnabled) {
    await feishu.start();
    stdout.write(
      `飞书 webhook 监听地址: http://${config.gateway.host}:${config.gateway.port}${feishu.webhookPath}\n`,
    );
  }

  const pending = new Map<string, (value: string) => void>();
  const routeOutbound = async (msg: OutboundMessage): Promise<void> => {
    if (msg.channel === "feishu" && feishu.isEnabled) {
      try {
        await feishu.send(msg);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr.write(`飞书发送错误: ${message}\n`);
      }
      return;
    }

    const metadata =
      typeof msg.metadata === "object" && msg.metadata !== null
        ? (msg.metadata as Record<string, unknown>)
        : {};
    const messageId = typeof metadata.message_id === "string" ? metadata.message_id : null;
    const isProgress = metadata._progress === true;

    if (messageId && pending.has(messageId)) {
      if (isProgress) {
        if (config.channels.sendProgress) {
          stdout.write(`  ↳ ${msg.content}\n`);
        }
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
  stdout.write(`Agent loop ready (Claude Agent SDK + 扩展功能). Workspace: ${workspace}\nType 'exit' to quit.\n`);

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
  cron.stop();
  await feishu.stop();
  agent.stop();
  await Promise.allSettled([runTask, outboundTask]);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`Fatal error: ${message}\n`);
  process.exitCode = 1;
});
