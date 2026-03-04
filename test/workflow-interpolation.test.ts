import { describe, expect, it } from "vitest";

import { extractJsonObject, interpolateTemplate } from "../src/workflow/interpolation.js";

describe("workflow interpolation", () => {
  it("interpolates trigger and upstream node outputs", () => {
    const result = interpolateTemplate(
      "Input={{trigger.input.path}}; Out={{node_a.output_path}}; Score={{node_a.metrics.rmse}}",
      {
        trigger: {
          input: {
            path: "/tmp/raw.csv",
          },
        },
        nodes: {
          node_a: {
            output_path: "/tmp/clean.csv",
            metrics: {
              rmse: 0.13,
            },
          },
        },
      },
    );

    expect(result).toContain("/tmp/raw.csv");
    expect(result).toContain("/tmp/clean.csv");
    expect(result).toContain("0.13");
  });

  it("throws on missing variable", () => {
    expect(() =>
      interpolateTemplate("{{node_missing.output}}", {
        trigger: {},
        nodes: {},
      }),
    ).toThrow("missing");
  });
});

describe("workflow JSON extraction", () => {
  it("parses whole-text JSON object", () => {
    const parsed = extractJsonObject('{"output_path":"/tmp/a.csv"}');
    expect(parsed).toEqual({ output_path: "/tmp/a.csv" });
  });

  it("parses fenced JSON with extra prose", () => {
    const parsed = extractJsonObject(`好的，这是结果：\n\n\`\`\`json\n{"report":"done","score":0.9}\n\`\`\``);
    expect(parsed).toEqual({ report: "done", score: 0.9 });
  });

  it("parses bare object with extra prose", () => {
    const parsed = extractJsonObject("analysis complete => {\"output_dir\":\"/tmp/out\"} thanks");
    expect(parsed).toEqual({ output_dir: "/tmp/out" });
  });

  it("throws when no JSON object is present", () => {
    expect(() => extractJsonObject("no json here")).toThrow("JSON object");
  });
});
