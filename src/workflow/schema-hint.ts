import type { WorkflowDefinition } from "./schema.js";

export const MIN_WORKFLOW_EXAMPLE: WorkflowDefinition = {
  id: "wf_example",
  trigger: {
    type: "manual",
  },
  execution: {
    mode: "serial",
  },
  nodes: [
    {
      id: "node_research",
      role: "researcher",
      taskPrompt: "Analyze '{{trigger.input}}' and return JSON with key 'summary'.",
      dependsOn: [],
      outputKeys: ["summary"],
      hitl: {
        enabled: false,
        highRiskTools: [],
      },
    },
    {
      id: "node_answer",
      role: "scientist",
      taskPrompt:
        "Use research: {{node_research.summary}}. Return JSON with key 'answer'.",
      dependsOn: ["node_research"],
      outputKeys: ["answer"],
      hitl: {
        enabled: false,
        highRiskTools: [],
      },
    },
  ],
};

const EXAMPLE_JSON = JSON.stringify(MIN_WORKFLOW_EXAMPLE, null, 2);

export const WORKFLOW_SCHEMA_HINT = [
  "workflow_json must follow OpenIntern WorkflowDefinition:",
  "- top-level required: id(string), trigger({type:\"manual\"}), nodes(array)",
  "- each node required: id(string), role(string), taskPrompt(string), dependsOn(string[])",
  "- interpolation syntax in taskPrompt: {{trigger.xxx}} or {{<dependsOnNodeId>.<outputKey>}}",
  "- if a node is referenced by interpolation, it must be listed in dependsOn",
  "- when referencing {{nodeId.key}}, source node MUST declare outputKeys including key",
  "- avoid {{nodeId.output}} unless source node.outputKeys explicitly contains \"output\"",
  "- optional node.hitl: { enabled(boolean), highRiskTools(string[]) }",
  "- when hitl.enabled=true, highRiskTools must be a non-empty array",
  "- dependsOn must always be an array (use [] when no dependency)",
  "",
  "Minimal valid example:",
  EXAMPLE_JSON,
  "",
  "Common mistakes to avoid:",
  "- missing node.role",
  "- node.dependsOn is not an array",
  "- using {{nodeId.output}} without declaring outputKeys: [\"output\"]",
  "- referencing {{otherNode.key}} when otherNode is not in dependsOn",
  "- hitl.enabled=true but hitl.highRiskTools is empty",
].join("\n");
