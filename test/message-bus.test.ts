import { describe, expect, it, vi } from "vitest";

import { MessageBus } from "../src/bus/message-bus.js";

describe("MessageBus publish observers", () => {
  it("notifies inbound observers with normalized payload", async () => {
    const bus = new MessageBus();
    const handler = vi.fn();
    bus.onInboundPublished(handler);

    await bus.publishInbound({
      channel: "cli",
      senderId: "user",
      chatId: "direct",
      content: "hello",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      channel: "cli",
      senderId: "user",
      chatId: "direct",
      content: "hello",
      media: [],
      metadata: {},
    });
  });

  it("notifies outbound observers with normalized payload", async () => {
    const bus = new MessageBus();
    const handler = vi.fn();
    bus.onOutboundPublished(handler);

    await bus.publishOutbound({
      channel: "cli",
      chatId: "direct",
      content: "world",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      channel: "cli",
      chatId: "direct",
      content: "world",
      media: [],
      metadata: {},
    });
  });

  it("notifies workflow status observers", async () => {
    const bus = new MessageBus();
    const runHandler = vi.fn();
    const nodeHandler = vi.fn();
    bus.onWorkflowRunStatusChanged(runHandler);
    bus.onWorkflowNodeStatusChanged(nodeHandler);

    await bus.emitWorkflowRunStatusChanged({
      type: "WORKFLOW_RUN_STATUS_CHANGED",
      runId: "run_1",
      workflowId: "wf_a",
      status: "running",
      previousStatus: null,
      error: null,
      originChannel: "cli",
      originChatId: "direct",
      timestamp: new Date(),
    });
    await bus.emitWorkflowNodeStatusChanged({
      type: "WORKFLOW_NODE_STATUS_CHANGED",
      runId: "run_1",
      workflowId: "wf_a",
      nodeId: "node_1",
      nodeName: "Node 1",
      status: "running",
      previousStatus: "pending",
      attempt: 1,
      maxAttempts: 2,
      currentTaskId: "task_1",
      lastError: null,
      timestamp: new Date(),
    });

    expect(runHandler).toHaveBeenCalledTimes(1);
    expect(nodeHandler).toHaveBeenCalledTimes(1);
    expect(runHandler.mock.calls[0]?.[0]).toMatchObject({ runId: "run_1", workflowId: "wf_a" });
    expect(nodeHandler.mock.calls[0]?.[0]).toMatchObject({ nodeId: "node_1", status: "running" });
  });
});
