import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Tool, type ToolExecutionContext } from "../tools/core/tool.js";
import type { JsonSchema } from "../tools/core/json-schema.js";

export class McpTool extends Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;

  constructor(
    private readonly client: Client,
    private readonly serverName: string,
    private readonly toolName: string,
    description: string,
    inputSchema: Record<string, unknown>,
  ) {
    super();
    this.name = `${serverName}__${toolName}`;
    this.description = description || `MCP tool ${toolName} from ${serverName}`;
    this.parameters = (inputSchema as JsonSchema) ?? { type: "object", properties: {} };
  }

  async execute(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    const result = await this.client.callTool({ name: this.toolName, arguments: params });
    const content = result.content as Array<{ type: string; text?: string }>;
    if (!Array.isArray(content)) {
      return JSON.stringify(result.content);
    }
    return content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n") || JSON.stringify(result.content);
  }
}
