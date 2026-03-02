function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPath(obj: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = obj;
  for (const segment of path) {
    if (!isObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function setPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i];
    const next = current[segment];
    if (!isObject(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

function movePath(
  obj: Record<string, unknown>,
  fromPath: string[],
  toPath: string[],
): void {
  const current = getPath(obj, toPath);
  if (current !== undefined) {
    return;
  }
  const value = getPath(obj, fromPath);
  if (value === undefined) {
    return;
  }
  setPath(obj, toPath, value);
}

export function migrateConfig(data: unknown): Record<string, unknown> {
  if (!isObject(data)) {
    return {};
  }

  const out = structuredClone(data);

  movePath(out, ["tools", "exec", "restrictToWorkspace"], ["tools", "restrictToWorkspace"]);
  movePath(out, ["agents", "defaults", "max_tool_iterations"], ["agents", "defaults", "maxToolIterations"]);
  movePath(out, ["agents", "defaults", "max_tokens"], ["agents", "defaults", "maxTokens"]);
  movePath(out, ["agents", "defaults", "memory_window"], ["agents", "defaults", "memoryWindow"]);
  movePath(out, ["agents", "defaults", "reasoning_effort"], ["agents", "defaults", "reasoningEffort"]);
  movePath(out, ["providers", "openai_compatible"], ["providers", "openaiCompatible"]);
  movePath(out, ["providers", "openaiCompatible", "api_key"], ["providers", "openaiCompatible", "apiKey"]);
  movePath(out, ["providers", "openaiCompatible", "api_base"], ["providers", "openaiCompatible", "apiBase"]);
  movePath(out, ["tools", "web", "search", "api_key"], ["tools", "web", "search", "apiKey"]);
  movePath(out, ["tools", "web", "search", "max_results"], ["tools", "web", "search", "maxResults"]);
  movePath(out, ["channels", "send_progress"], ["channels", "sendProgress"]);
  movePath(out, ["channels", "send_tool_hints"], ["channels", "sendToolHints"]);
  movePath(out, ["gateway", "heartbeat", "interval_s"], ["gateway", "heartbeat", "intervalS"]);

  return out;
}
