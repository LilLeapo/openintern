import { Tool } from "../core/tool.js";

const USER_AGENT = "openintern-agent/0.1";
const MAX_REDIRECTS = 5;

function stripTags(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function validateUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return `Only http/https allowed, got '${parsed.protocol.replace(":", "")}'`;
    }
    if (!parsed.hostname) {
      return "Missing domain";
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export class WebSearchTool extends Tool {
  readonly name = "web_search";
  readonly description = "Search the web. Returns titles, URLs, and snippets.";
  readonly parameters = {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      count: { type: "integer", description: "Results (1-10)", minimum: 1, maximum: 10 },
    },
    required: ["query"],
  } as const;

  constructor(
    private readonly apiKey: string,
    private readonly maxResults = 5,
    private readonly _proxy?: string | null,
  ) {
    super();
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const query = String(params.query ?? "");
    const count = Math.min(Math.max(Number(params.count ?? this.maxResults), 1), 10);
    if (!this.apiKey) {
      return (
        "Error: Brave Search API key not configured. " +
        "Set tools.web.search.apiKey in ~/.openintern/config.json."
      );
    }

    try {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(count));

      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "x-subscription-token": this.apiKey,
          "user-agent": USER_AGENT,
        },
      });
      if (!response.ok) {
        return `Error: Brave search failed (${response.status} ${response.statusText})`;
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const web =
        payload.web && typeof payload.web === "object" ? (payload.web as Record<string, unknown>) : {};
      const results = Array.isArray(web.results) ? web.results : [];
      if (results.length === 0) {
        return `No results for: ${query}`;
      }

      const lines = [`Results for: ${query}`, ""];
      for (const [index, result] of results.slice(0, count).entries()) {
        if (typeof result !== "object" || result === null) {
          continue;
        }
        const item = result as Record<string, unknown>;
        const title = typeof item.title === "string" ? item.title : "";
        const link = typeof item.url === "string" ? item.url : "";
        const desc = typeof item.description === "string" ? item.description : "";
        lines.push(`${index + 1}. ${title}`);
        lines.push(`   ${link}`);
        if (desc) {
          lines.push(`   ${desc}`);
        }
      }
      return lines.join("\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: ${message}`;
    }
  }
}

export class WebFetchTool extends Tool {
  readonly name = "web_fetch";
  readonly description = "Fetch URL and extract readable content.";
  readonly parameters = {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to fetch" },
      extractMode: {
        type: "string",
        enum: ["markdown", "text"],
        description: "Output mode (markdown or text)",
      },
      maxChars: { type: "integer", minimum: 100, description: "Maximum output length" },
    },
    required: ["url"],
  } as const;

  constructor(
    private readonly maxChars = 50_000,
    private readonly _proxy?: string | null,
  ) {
    super();
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const url = String(params.url ?? "");
    const extractMode = params.extractMode === "text" ? "text" : "markdown";
    const maxChars = Number(params.maxChars ?? this.maxChars);

    const validationError = validateUrl(url);
    if (validationError) {
      return JSON.stringify({ error: `URL validation failed: ${validationError}`, url });
    }

    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT },
        redirect: "follow",
      });
      if (!response.ok) {
        return JSON.stringify({
          error: `Fetch failed (${response.status} ${response.statusText})`,
          url,
        });
      }

      const contentType = response.headers.get("content-type") ?? "";
      const finalUrl = response.url;
      let text = "";
      let extractor = "raw";

      if (contentType.includes("application/json")) {
        const json = (await response.json()) as unknown;
        text = JSON.stringify(json, null, 2);
        extractor = "json";
      } else {
        const raw = await response.text();
        const isHtml =
          contentType.includes("text/html") ||
          raw.slice(0, 256).toLowerCase().includes("<html");
        if (isHtml) {
          const clean = stripTags(raw);
          text = extractMode === "markdown" ? clean : clean;
          extractor = "html";
        } else {
          text = raw;
          extractor = "raw";
        }
      }

      const truncated = text.length > maxChars;
      if (truncated) {
        text = text.slice(0, maxChars);
      }

      return JSON.stringify({
        url,
        finalUrl,
        status: response.status,
        extractor,
        redirectsLimit: MAX_REDIRECTS,
        truncated,
        length: text.length,
        text,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ error: message, url });
    }
  }
}

