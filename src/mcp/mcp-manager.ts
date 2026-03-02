import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpConfig } from "../config/schema.js";
import type { ToolRegistry } from "../tools/core/tool-registry.js";
import { McpTool } from "./mcp-tool.js";

interface Connection {
  client: Client;
  transport: StdioClientTransport;
}

export class McpManager {
  private readonly connections = new Map<string, Connection>();

  async connectAll(config: McpConfig, registry: ToolRegistry): Promise<void> {
    const entries = Object.entries(config.servers).filter(([, s]) => !s.disabled);
    const results = await Promise.allSettled(
      entries.map(async ([name, serverConfig]) => {
        const transport = new StdioClientTransport({
          command: serverConfig.command,
          args: serverConfig.args,
          env: serverConfig.env as Record<string, string> | undefined,
        });
        const client = new Client({ name: `openintern-${name}`, version: "0.1.0" });
        await client.connect(transport);
        this.connections.set(name, { client, transport });

        const { tools } = await client.listTools();
        for (const tool of tools) {
          registry.register(
            new McpTool(client, name, tool.name, tool.description ?? "", tool.inputSchema as Record<string, unknown>),
          );
        }
        return tools.length;
      }),
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const name = entries[i][0];
      if (r.status === "fulfilled") {
        console.error(`[mcp] ${name}: ${r.value} tool(s) registered`);
      } else {
        console.error(`[mcp] ${name}: failed to connect - ${r.reason}`);
      }
    }
  }

  async closeAll(): Promise<void> {
    const closing = Array.from(this.connections.entries()).map(async ([name, conn]) => {
      try {
        await conn.transport.close();
      } catch (e) {
        console.error(`[mcp] ${name}: close error -`, e);
      }
    });
    await Promise.allSettled(closing);
    this.connections.clear();
  }
}
