import { Tool, type ToolExecutionContext } from "./tool.js";

const RETRY_HINT = "\n\n[Analyze the error above and try a different approach.]";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getDefinitions(): Record<string, unknown>[] {
    return Array.from(this.tools.values()).map((tool) => tool.toSchema());
  }

  get names(): string[] {
    return Array.from(this.tools.keys());
  }

  async execute(
    name: string,
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: Tool '${name}' not found. Available: ${this.names.join(", ")}`;
    }

    try {
      const errors = tool.validateParams(params);
      if (errors.length > 0) {
        return `Error: Invalid parameters for tool '${name}': ${errors.join("; ")}${RETRY_HINT}`;
      }
      const result = await tool.execute(params, context);
      if (result.startsWith("Error")) {
        return `${result}${RETRY_HINT}`;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error executing ${name}: ${message}${RETRY_HINT}`;
    }
  }
}

