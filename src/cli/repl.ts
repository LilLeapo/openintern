import readline from "node:readline/promises";
import { stderr, stdin, stdout } from "node:process";
import { mkdir } from "node:fs/promises";

import { AgentLoop } from "../agent/loop.js";
import { MessageBus } from "../bus/message-bus.js";
import { loadOrCreateConfig, resolveWorkspacePath } from "../config/loader.js";
import { makeProvider } from "../llm/provider-factory.js";
import { syncWorkspaceTemplates } from "../templates/sync.js";

async function main(): Promise<void> {
  const config = await loadOrCreateConfig();
  const workspace = resolveWorkspacePath(config);
  await mkdir(workspace, { recursive: true });
  await syncWorkspaceTemplates(workspace);

  const bus = new MessageBus();
  const provider = makeProvider(config);
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
    channelsConfig: config.channels,
  });

  const rl = readline.createInterface({ input: stdin, output: stdout });
  stdout.write(`Agent loop ready. Workspace: ${workspace}\nType 'exit' to quit.\n`);
  while (true) {
    const line = (await rl.question("You: ")).trim();
    if (!line) {
      continue;
    }
    if (line.toLowerCase() === "exit") {
      break;
    }

    const response = await agent.processDirect({
      content: line,
      sessionKey: "cli:direct",
      channel: "cli",
      chatId: "direct",
    });
    stdout.write(`Agent: ${response}\n`);
  }
  rl.close();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`Fatal error: ${message}\n`);
  if (message.includes("No API key configured")) {
    stderr.write("Configure ~/.openintern/config.json -> providers.openaiCompatible.apiKey\n");
  }
  process.exitCode = 1;
});
