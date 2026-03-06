import { describe, expect, it } from "vitest";

import { MessageBus } from "../src/bus/message-bus.js";

describe("MessageBus approval events", () => {
  it("publishes approval lifecycle events to subscribers", async () => {
    const bus = new MessageBus();
    const seen: string[] = [];

    const offRequested = bus.onSubagentApprovalRequested((event) => {
      seen.push(`${event.type}:${event.approvalId}`);
    });
    const offGranted = bus.onSubagentApprovalGranted((event) => {
      seen.push(`${event.type}:${event.approvalId}`);
    });

    await bus.emitSubagentApprovalRequested({
      type: "SUBAGENT_APPROVAL_REQUESTED",
      approvalId: "a1",
      taskId: "t1",
      runId: "r1",
      nodeId: "n1",
      nodeName: "Node 1",
      approvalTarget: "owner",
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
      toolCalls: [
        {
          id: "tc1",
          name: "exec",
          arguments: { command: "echo hi" },
          highRisk: true,
        },
      ],
      commandPreview: "echo hi",
      originChannel: "workflow",
      originChatId: "r1:n1",
    });

    await bus.emitSubagentApprovalGranted({
      type: "SUBAGENT_APPROVAL_GRANTED",
      approvalId: "a1",
      taskId: "t1",
      approver: "u1",
      approvedAt: new Date(),
    });

    expect(seen).toEqual([
      "SUBAGENT_APPROVAL_REQUESTED:a1",
      "SUBAGENT_APPROVAL_GRANTED:a1",
    ]);

    offRequested();
    offGranted();

    await bus.emitSubagentApprovalRequested({
      type: "SUBAGENT_APPROVAL_REQUESTED",
      approvalId: "a2",
      taskId: "t2",
      runId: "r2",
      nodeId: "n2",
      nodeName: "Node 2",
      approvalTarget: "group",
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
      toolCalls: [],
      commandPreview: "",
      originChannel: "workflow",
      originChatId: "r2:n2",
    });

    expect(seen).toHaveLength(2);
  });
});
