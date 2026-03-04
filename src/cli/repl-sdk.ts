import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import readline from "node:readline/promises";
import { stderr, stdin, stdout } from "node:process";

import { SdkAgent } from "../agent/sdk-agent.js";
import { MessageBus } from "../bus/message-bus.js";
import type { OutboundMessage } from "../bus/events.js";
import { loadOrCreateConfig, resolveWorkspacePath } from "../config/loader.js";
import { syncWorkspaceTemplates } from "../templates/sync.js";

async function main(): Promise<void> {
  const config = await loadOrCreateConfig();
  const workspace = resolveWorkspacePath(config);
  await mkdir(workspace, { recursive: true });
  await syncWorkspaceTemplates(workspace);

  const bus = new MessageBus();

  // 获取 API key
  const apiKey = process.env.ANTHROPIC_API_KEY || config.providers.anthropicCompatible.apiKey;
  if (!apiKey) {
    throw new Error("需要设置 ANTHROPIC_API_KEY 环境变量或在配置文件中设置 providers.anthropicCompatible.apiKey");
  }

  const agent = new SdkAgent({
    bus,
    workspace,
    apiKey,
    model: config.agents.defaults.model,
    maxIterations: config.agents.defaults.maxToolIterations,
    maxTokens: config.agents.defaults.maxTokens,
    temperature: config.agents.defaults.temperature,
    restrictToWorkspace: config.tools.restrictToWorkspace,
    mcpConfig: config.mcp,
    memoryConfig: config.memory,
    channelsConfig: config.channels,
  });

  let running = true;
  const runTask = agent.run();

  const pending = new Map<string, (value: string) => void>();
  const routeOutbound = async (msg: OutboundMessage): Promise<void> => {
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
  stdout.write(`Agent loop ready (Claude Agent SDK). Workspace: ${workspace}\nType 'exit' to quit.\n`);

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
  agent.stop();
  await Promise.allSettled([runTask, outboundTask]);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`Fatal error: ${message}\n`);
  process.exitCode = 1;
});
