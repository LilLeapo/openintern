import { randomUUID } from "node:crypto";
import readline from "node:readline/promises";
import { stderr, stdin, stdout } from "node:process";

import type { InboundMessage, OutboundMessage } from "../bus/events.js";
import { createAppRuntime } from "./runtime.js";
import { createLogger } from "../utils/logger.js";

type CliMode = "repl" | "gateway";

function parseCliMode(argv: string[]): CliMode {
  const normalizedArgv = argv.filter((arg) => arg !== "--");
  const first = normalizedArgv[0]?.trim().toLowerCase();
  if (!first || first === "repl" || first === "chat" || first === "agent") {
    return "repl";
  }
  if (first === "gateway") {
    return "gateway";
  }
  throw new Error(`Unknown command '${normalizedArgv[0]}'. Supported commands: gateway`);
}

function shortText(value: string, max = 120): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) {
    return clean;
  }
  return `${clean.slice(0, max - 3)}...`;
}

function isProgressMessage(message: OutboundMessage): boolean {
  return message.metadata?._progress === true;
}

function isToolHintMessage(message: OutboundMessage): boolean {
  return message.metadata?._tool_hint === true;
}

async function startRuntime() {
  const runtime = await createAppRuntime();
  await runtime.agent.initMcp();
  const runTask = runtime.agent.run();
  await runtime.cron.start();
  await runtime.heartbeat.start();
  if (runtime.feishu.isEnabled) {
    await runtime.feishu.start();
  }
  return {
    runtime,
    runTask,
  };
}

async function stopRuntime(state: Awaited<ReturnType<typeof startRuntime>>): Promise<void> {
  state.runtime.heartbeat.stop();
  state.runtime.cron.stop();
  await state.runtime.feishu.stop();
  state.runtime.agent.stop();
  await Promise.allSettled([state.runTask]);
}

async function runRepl(): Promise<void> {
  const state = await startRuntime();
  const { runtime } = state;

  let running = true;
  const pending = new Map<string, (value: string) => void>();

  const routeOutbound = async (msg: OutboundMessage): Promise<void> => {
    if (msg.channel === "feishu" && runtime.feishu.isEnabled) {
      try {
        await runtime.feishu.send(msg);
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
        if (isToolHint && !runtime.config.channels.sendToolHints) {
          return;
        }
        if (!isToolHint && !runtime.config.channels.sendProgress) {
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
      const msg = await runtime.bus.consumeOutbound(500);
      if (!msg) {
        continue;
      }
      await routeOutbound(msg);
    }
  })();

  const rl = readline.createInterface({ input: stdin, output: stdout });
  stdout.write(`Agent loop ready. Workspace: ${runtime.workspace}\nType 'exit' to quit.\n`);

  const sendUserMessage = async (content: string): Promise<string> => {
    const messageId = `cli_${randomUUID().slice(0, 8)}`;
    const responsePromise = new Promise<string>((resolve) => {
      pending.set(messageId, resolve);
    });
    await runtime.bus.publishInbound({
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

  try {
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
  } finally {
    running = false;
    rl.close();
    await stopRuntime(state);
    await Promise.allSettled([outboundTask]);
  }
}

async function runGateway(): Promise<void> {
  const logger = createLogger("gateway");
  const state = await startRuntime();
  const { runtime } = state;
  let shuttingDown = false;

  const unsubscribers = [
    runtime.bus.onInboundPublished(async (message: InboundMessage) => {
      logger.info("Inbound message", {
        channel: message.channel,
        chat_id: message.chatId,
        sender: message.senderId,
        content: shortText(message.content),
      });
    }),
    runtime.bus.onOutboundPublished(async (message: OutboundMessage) => {
      const kind = isProgressMessage(message)
        ? isToolHintMessage(message)
          ? "tool_hint"
          : "progress"
        : "response";
      logger.info("Outbound message", {
        channel: message.channel,
        chat_id: message.chatId,
        kind,
        content: shortText(message.content),
      });
    }),
    runtime.bus.onSubagentEvent(async (event) => {
      logger.info("Subagent event", {
        type: event.type,
        task_id: event.taskId,
        status: event.status,
        role: event.role ?? "",
        label: shortText(event.label, 80),
      });
    }),
    runtime.bus.onSubagentApprovalRequested(async (event) => {
      logger.warn("Approval requested", {
        approval_id: event.approvalId,
        task_id: event.taskId,
        node_id: event.nodeId,
        tools: event.toolCalls.map((tool) => tool.name).join(","),
      });
    }),
    runtime.bus.onSubagentApprovalGranted(async (event) => {
      logger.info("Approval granted", {
        approval_id: event.approvalId,
        task_id: event.taskId,
        approver: event.approver,
      });
    }),
    runtime.bus.onSubagentApprovalExpired(async (event) => {
      logger.warn("Approval expired", {
        approval_id: event.approvalId,
        task_id: event.taskId,
        reason: shortText(event.reason, 80),
      });
    }),
    runtime.bus.onSubagentApprovalCancelled(async (event) => {
      logger.warn("Approval cancelled", {
        approval_id: event.approvalId,
        task_id: event.taskId,
        reason: shortText(event.reason, 80),
      });
    }),
    runtime.bus.onWorkflowRunStatusChanged(async (event) => {
      logger.info("Workflow run status changed", {
        run_id: event.runId,
        workflow_id: event.workflowId,
        previous_status: event.previousStatus ?? "",
        status: event.status,
        origin: `${event.originChannel}:${event.originChatId}`,
        error: event.error ? shortText(event.error, 120) : "",
      });
    }),
    runtime.bus.onWorkflowNodeStatusChanged(async (event) => {
      logger.info("Workflow node status changed", {
        run_id: event.runId,
        workflow_id: event.workflowId,
        node_id: event.nodeId,
        node_name: event.nodeName ?? "",
        previous_status: event.previousStatus ?? "",
        status: event.status,
        attempt: `${event.attempt}/${event.maxAttempts}`,
        task_id: event.currentTaskId ?? "",
        error: event.lastError ? shortText(event.lastError, 120) : "",
      });
    }),
  ];

  const outboundTask = (async () => {
    while (!shuttingDown) {
      const msg = await runtime.bus.consumeOutbound(500);
      if (!msg) {
        continue;
      }
      if (msg.channel === "feishu" && runtime.feishu.isEnabled) {
        try {
          await runtime.feishu.send(msg);
        } catch (error) {
          logger.error("Feishu send failed", {
            chat_id: msg.chatId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  })();

  logger.info("Gateway started", {
    workspace: runtime.workspace,
    host: runtime.config.gateway.host,
    port: runtime.config.gateway.port,
    feishu_enabled: runtime.feishu.isEnabled ? "yes" : "no",
  });

  if (runtime.feishu.isEnabled) {
    const appId = runtime.config.channels.feishu.appId || "";
    const appIdMasked =
      appId.length > 8 ? `${appId.slice(0, 6)}***${appId.slice(-4)}` : appId || "(empty)";
    logger.info("Feishu long connection started", {
      app_id: appIdMasked,
    });
  }

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      logger.info("Gateway stopping");
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

  unsubscribers.forEach((unsubscribe) => unsubscribe());
  await stopRuntime(state);
  await Promise.allSettled([outboundTask]);
  logger.info("Gateway stopped");
}

async function main(): Promise<void> {
  const mode = parseCliMode(process.argv.slice(2));
  if (mode === "gateway") {
    await runGateway();
    return;
  }
  await runRepl();
}

export { main, parseCliMode };
