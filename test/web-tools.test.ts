import { afterEach, describe, expect, it, vi } from "vitest";

import { WebFetchTool, WebSearchTool } from "../src/tools/builtins/web.js";

describe("web tools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("web_search returns config error when api key missing", async () => {
    const tool = new WebSearchTool("");
    const out = await tool.execute({ query: "nanobot" });
    expect(out).toContain("API key not configured");
  });

  it("web_search formats result list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          web: {
            results: [
              {
                title: "Result 1",
                url: "https://example.com/1",
                description: "desc1",
              },
            ],
          },
        }),
      })),
    );
    const tool = new WebSearchTool("brave-key");
    const out = await tool.execute({ query: "test" });
    expect(out).toContain("Results for: test");
    expect(out).toContain("https://example.com/1");
  });

  it("web_fetch validates url", async () => {
    const tool = new WebFetchTool();
    const out = await tool.execute({ url: "file:///etc/passwd" });
    expect(out).toContain("URL validation failed");
  });
});

