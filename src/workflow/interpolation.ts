export interface InterpolationContext {
  trigger: Record<string, unknown>;
  nodes: Record<string, Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolvePath(root: unknown, path: string): unknown {
  const segments = path.split(".").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new Error("Interpolation variable path is empty.");
  }

  let current: unknown = root;
  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function toInterpolationString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}

export function interpolateTemplate(template: string, context: InterpolationContext): string {
  return template.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_match, rawExpr: string) => {
    const expr = rawExpr.trim();
    if (!expr) {
      throw new Error("Interpolation variable cannot be empty.");
    }

    const segments = expr.split(".");
    if (segments.length < 2) {
      throw new Error(`Interpolation variable '${expr}' is invalid. Use trigger.xxx or nodeId.xxx.`);
    }

    const [prefix, ...rest] = segments;
    const value =
      prefix === "trigger"
        ? resolvePath(context.trigger, rest.join("."))
        : resolvePath(context.nodes[prefix], rest.join("."));

    if (value === undefined) {
      throw new Error(`Interpolation variable '${expr}' is missing.`);
    }

    return toInterpolationString(value);
  });
}

function parseJsonObject(candidate: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function extractFencedCandidates(text: string): string[] {
  const out: string[] = [];
  const pattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const block = match[1]?.trim();
    if (block) {
      out.push(block);
    }
  }
  return out;
}

function extractBalancedBraceCandidates(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return out;
}

export function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Subagent result is empty; expected JSON object output.");
  }

  const whole = parseJsonObject(trimmed);
  if (whole) {
    return whole;
  }

  const fenced = extractFencedCandidates(trimmed);
  for (const candidate of fenced) {
    const parsed = parseJsonObject(candidate);
    if (parsed) {
      return parsed;
    }
  }

  const balanced = extractBalancedBraceCandidates(trimmed)
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0);
  balanced.sort((a, b) => b.length - a.length);

  for (const candidate of balanced) {
    const parsed = parseJsonObject(candidate);
    if (parsed) {
      return parsed;
    }
  }

  const regexCandidate = trimmed.match(/\{[\s\S]*\}/)?.[0]?.trim();
  if (regexCandidate) {
    const parsed = parseJsonObject(regexCandidate);
    if (parsed) {
      return parsed;
    }
  }

  throw new Error("Subagent result does not contain a valid JSON object output.");
}
