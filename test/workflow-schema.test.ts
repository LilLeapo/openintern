import { describe, expect, it } from "vitest";

import { parseWorkflowDefinition } from "../src/workflow/schema.js";

describe("workflow schema", () => {
  it("defaults skillNames to empty array when omitted", () => {
    const parsed = parseWorkflowDefinition({
      id: "wf_1",
      trigger: {
        type: "manual",
      },
      nodes: [
        {
          id: "node_a",
          role: "scientist",
          taskPrompt: "Summarize {{trigger.input}}",
          dependsOn: [],
        },
      ],
    });

    expect(parsed.nodes[0]?.skillNames).toEqual([]);
    expect(parsed.nodes[0]?.hitl).toEqual({
      enabled: false,
      highRiskTools: [],
      approvalTarget: "owner",
      approvalTimeoutMs: 7_200_000,
    });
    expect(parsed.execution.mode).toBe("serial");
    expect(parsed.execution.maxParallel).toBe(1);
  });

  it("rejects unknown dependency references", () => {
    expect(() =>
      parseWorkflowDefinition({
        id: "wf_2",
        trigger: {
          type: "manual",
        },
        nodes: [
          {
            id: "node_a",
            role: "scientist",
            taskPrompt: "A",
            dependsOn: ["node_x"],
          },
        ],
      }),
    ).toThrow("depends on unknown node");
  });

  it("rejects cycles", () => {
    expect(() =>
      parseWorkflowDefinition({
        id: "wf_3",
        trigger: {
          type: "manual",
        },
        nodes: [
          {
            id: "node_a",
            role: "scientist",
            taskPrompt: "A",
            dependsOn: ["node_b"],
          },
          {
            id: "node_b",
            role: "scientist",
            taskPrompt: "B",
            dependsOn: ["node_a"],
          },
        ],
      }),
    ).toThrow("DAG");
  });

  it("rejects invalid parallel maxParallel", () => {
    expect(() =>
      parseWorkflowDefinition({
        id: "wf_4",
        trigger: {
          type: "manual",
        },
        execution: {
          mode: "parallel",
          maxParallel: 0,
        },
        nodes: [
          {
            id: "node_a",
            role: "scientist",
            taskPrompt: "A",
            dependsOn: [],
          },
        ],
      }),
    ).toThrow("maxParallel");
  });

  it("rejects hitl enabled with empty highRiskTools", () => {
    expect(() =>
      parseWorkflowDefinition({
        id: "wf_5",
        trigger: {
          type: "manual",
        },
        nodes: [
          {
            id: "node_a",
            role: "scientist",
            taskPrompt: "A",
            dependsOn: [],
            hitl: {
              enabled: true,
              highRiskTools: [],
            },
          },
        ],
      }),
    ).toThrow("highRiskTools");
  });

  it("normalizes hitl defaults", () => {
    const parsed = parseWorkflowDefinition({
      id: "wf_6",
      trigger: {
        type: "manual",
      },
      nodes: [
        {
          id: "node_a",
          role: "scientist",
          taskPrompt: "A",
          dependsOn: [],
          hitl: {
            enabled: true,
            highRiskTools: ["exec", "exec", " write_file "],
          },
        },
      ],
    });

    expect(parsed.nodes[0]?.hitl).toEqual({
      enabled: true,
      highRiskTools: ["exec", "write_file"],
      approvalTarget: "owner",
      approvalTimeoutMs: 7_200_000,
    });
  });

  it("rejects interpolation with source node not in dependsOn", () => {
    expect(() =>
      parseWorkflowDefinition({
        id: "wf_7",
        trigger: {
          type: "manual",
        },
        nodes: [
          {
            id: "node_a",
            role: "scientist",
            taskPrompt: "A",
            dependsOn: [],
            outputKeys: ["summary"],
          },
          {
            id: "node_b",
            role: "scientist",
            taskPrompt: "Use {{node_a.summary}}",
            dependsOn: [],
          },
        ],
      }),
    ).toThrow("not listed in dependsOn");
  });

  it("rejects interpolation key not declared in source outputKeys", () => {
    expect(() =>
      parseWorkflowDefinition({
        id: "wf_8",
        trigger: {
          type: "manual",
        },
        nodes: [
          {
            id: "node_a",
            role: "scientist",
            taskPrompt: "A",
            dependsOn: [],
            outputKeys: ["summary"],
          },
          {
            id: "node_b",
            role: "scientist",
            taskPrompt: "Use {{node_a.output}}",
            dependsOn: ["node_a"],
          },
        ],
      }),
    ).toThrow("does not declare outputKeys including 'output'");
  });

  it("rejects interpolation when source node has no outputKeys", () => {
    expect(() =>
      parseWorkflowDefinition({
        id: "wf_9",
        trigger: {
          type: "manual",
        },
        nodes: [
          {
            id: "node_a",
            role: "scientist",
            taskPrompt: "A",
            dependsOn: [],
            outputKeys: [],
          },
          {
            id: "node_b",
            role: "scientist",
            taskPrompt: "Use {{node_a.summary}}",
            dependsOn: ["node_a"],
          },
        ],
      }),
    ).toThrow("does not declare outputKeys");
  });
});
