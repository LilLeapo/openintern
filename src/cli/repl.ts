import readline from "node:readline/promises";
import { stderr, stdin, stdout } from "node:process";

import { AgentLoop } from "../agent/loop.js";
import { MessageBus } from "../bus/message-bus.js";
import { EchoProvider } from "../llm/echo-provider.js";

async function main(): Promise<void> {
  const bus = new MessageBus();
  const provider = new EchoProvider();
  const agent = new AgentLoop({
    bus,
    provider,
    workspace: process.cwd(),
  });

  const rl = readline.createInterface({ input: stdin, output: stdout });
  stdout.write("Agent loop ready. Type 'exit' to quit.\n");
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
  process.exitCode = 1;
});
