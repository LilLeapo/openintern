import type { WorkflowDefinition } from "./schema.js";

export const MIN_WORKFLOW_EXAMPLE: WorkflowDefinition = {
  id: "wf_example",
  trigger: {
    type: "manual",
  },
  nodes: [
    {
      id: "node_main",
      role: "scientist",
      taskPrompt: "Process {{trigger.input}} and return JSON result.",
      dependsOn: [],
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
  "- hitl.enabled=true but hitl.highRiskTools is empty",
].join("\n");
