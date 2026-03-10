import { main } from "./cli/repl.js";

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Fatal error: ${message}\n`);
  if (message.includes("No API key configured")) {
    process.stderr.write(
      "Configure ~/.openintern/config.json -> providers.openaiCompatible.apiKey or providers.anthropicCompatible.apiKey\n",
    );
  }
  process.exitCode = 1;
});
