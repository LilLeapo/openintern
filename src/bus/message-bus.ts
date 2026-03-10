import { AsyncQueue } from "./async-queue.js";
import type {
  AgentTraceEvent,
  InboundMessage,
  OutboundMessage,
  SubagentApprovalCancelledEvent,
  SubagentApprovalExpiredEvent,
  SubagentApprovalGrantedEvent,
  SubagentApprovalRequestedEvent,
  SubagentTaskEvent,
  WorkflowNodeStatusChangedEvent,
  WorkflowRunStatusChangedEvent,
} from "./events.js";

export class MessageBus {
  private readonly inboundQueue = new AsyncQueue<InboundMessage>();
  private readonly outboundQueue = new AsyncQueue<OutboundMessage>();
  private readonly agentTraceHandlers = new Set<
    (event: AgentTraceEvent) => void | Promise<void>
  >();
  private readonly inboundPublishedHandlers = new Set<
    (message: InboundMessage) => void | Promise<void>
  >();
  private readonly outboundPublishedHandlers = new Set<
    (message: OutboundMessage) => void | Promise<void>
  >();
  private readonly subagentHandlers = new Set<
    (event: SubagentTaskEvent) => void | Promise<void>
  >();
  private readonly approvalRequestedHandlers = new Set<
    (event: SubagentApprovalRequestedEvent) => void | Promise<void>
  >();
  private readonly approvalGrantedHandlers = new Set<
    (event: SubagentApprovalGrantedEvent) => void | Promise<void>
  >();
  private readonly approvalExpiredHandlers = new Set<
    (event: SubagentApprovalExpiredEvent) => void | Promise<void>
  >();
  private readonly approvalCancelledHandlers = new Set<
    (event: SubagentApprovalCancelledEvent) => void | Promise<void>
  >();
  private readonly workflowRunStatusHandlers = new Set<
    (event: WorkflowRunStatusChangedEvent) => void | Promise<void>
  >();
  private readonly workflowNodeStatusHandlers = new Set<
    (event: WorkflowNodeStatusChangedEvent) => void | Promise<void>
  >();

  async publishInbound(message: InboundMessage): Promise<void> {
    const normalized = {
      ...message,
      timestamp: message.timestamp ?? new Date(),
      media: message.media ?? [],
      metadata: message.metadata ?? {},
    };
    this.inboundQueue.enqueue(normalized);
    const handlers = Array.from(this.inboundPublishedHandlers);
    await Promise.all(handlers.map(async (handler) => handler(normalized)));
  }

  async consumeInbound(timeoutMs?: number): Promise<InboundMessage | null> {
    return this.inboundQueue.dequeue(timeoutMs);
  }

  async publishOutbound(message: OutboundMessage): Promise<void> {
    const normalized = {
      ...message,
      media: message.media ?? [],
      metadata: message.metadata ?? {},
    };
    this.outboundQueue.enqueue(normalized);
    const handlers = Array.from(this.outboundPublishedHandlers);
    await Promise.all(handlers.map(async (handler) => handler(normalized)));
  }

  async consumeOutbound(timeoutMs?: number): Promise<OutboundMessage | null> {
    return this.outboundQueue.dequeue(timeoutMs);
  }

  onInboundPublished(handler: (message: InboundMessage) => void | Promise<void>): () => void {
    this.inboundPublishedHandlers.add(handler);
    return () => {
      this.inboundPublishedHandlers.delete(handler);
    };
  }

  onOutboundPublished(handler: (message: OutboundMessage) => void | Promise<void>): () => void {
    this.outboundPublishedHandlers.add(handler);
    return () => {
      this.outboundPublishedHandlers.delete(handler);
    };
  }

  onAgentTraceEvent(handler: (event: AgentTraceEvent) => void | Promise<void>): () => void {
    this.agentTraceHandlers.add(handler);
    return () => {
      this.agentTraceHandlers.delete(handler);
    };
  }

  async emitAgentTraceEvent(event: AgentTraceEvent): Promise<void> {
    const handlers = Array.from(this.agentTraceHandlers);
    await Promise.all(handlers.map(async (handler) => handler(event)));
  }

  onSubagentEvent(handler: (event: SubagentTaskEvent) => void | Promise<void>): () => void {
    this.subagentHandlers.add(handler);
    return () => {
      this.subagentHandlers.delete(handler);
    };
  }

  async emitSubagentEvent(event: SubagentTaskEvent): Promise<void> {
    const handlers = Array.from(this.subagentHandlers);
    await Promise.all(handlers.map(async (handler) => handler(event)));
  }

  onSubagentApprovalRequested(
    handler: (event: SubagentApprovalRequestedEvent) => void | Promise<void>,
  ): () => void {
    this.approvalRequestedHandlers.add(handler);
    return () => {
      this.approvalRequestedHandlers.delete(handler);
    };
  }

  async emitSubagentApprovalRequested(event: SubagentApprovalRequestedEvent): Promise<void> {
    const handlers = Array.from(this.approvalRequestedHandlers);
    await Promise.all(handlers.map(async (handler) => handler(event)));
  }

  onSubagentApprovalGranted(
    handler: (event: SubagentApprovalGrantedEvent) => void | Promise<void>,
  ): () => void {
    this.approvalGrantedHandlers.add(handler);
    return () => {
      this.approvalGrantedHandlers.delete(handler);
    };
  }

  async emitSubagentApprovalGranted(event: SubagentApprovalGrantedEvent): Promise<void> {
    const handlers = Array.from(this.approvalGrantedHandlers);
    await Promise.all(handlers.map(async (handler) => handler(event)));
  }

  onSubagentApprovalExpired(
    handler: (event: SubagentApprovalExpiredEvent) => void | Promise<void>,
  ): () => void {
    this.approvalExpiredHandlers.add(handler);
    return () => {
      this.approvalExpiredHandlers.delete(handler);
    };
  }

  async emitSubagentApprovalExpired(event: SubagentApprovalExpiredEvent): Promise<void> {
    const handlers = Array.from(this.approvalExpiredHandlers);
    await Promise.all(handlers.map(async (handler) => handler(event)));
  }

  onSubagentApprovalCancelled(
    handler: (event: SubagentApprovalCancelledEvent) => void | Promise<void>,
  ): () => void {
    this.approvalCancelledHandlers.add(handler);
    return () => {
      this.approvalCancelledHandlers.delete(handler);
    };
  }

  async emitSubagentApprovalCancelled(event: SubagentApprovalCancelledEvent): Promise<void> {
    const handlers = Array.from(this.approvalCancelledHandlers);
    await Promise.all(handlers.map(async (handler) => handler(event)));
  }

  onWorkflowRunStatusChanged(
    handler: (event: WorkflowRunStatusChangedEvent) => void | Promise<void>,
  ): () => void {
    this.workflowRunStatusHandlers.add(handler);
    return () => {
      this.workflowRunStatusHandlers.delete(handler);
    };
  }

  async emitWorkflowRunStatusChanged(event: WorkflowRunStatusChangedEvent): Promise<void> {
    const handlers = Array.from(this.workflowRunStatusHandlers);
    await Promise.all(handlers.map(async (handler) => handler(event)));
  }

  onWorkflowNodeStatusChanged(
    handler: (event: WorkflowNodeStatusChangedEvent) => void | Promise<void>,
  ): () => void {
    this.workflowNodeStatusHandlers.add(handler);
    return () => {
      this.workflowNodeStatusHandlers.delete(handler);
    };
  }

  async emitWorkflowNodeStatusChanged(event: WorkflowNodeStatusChangedEvent): Promise<void> {
    const handlers = Array.from(this.workflowNodeStatusHandlers);
    await Promise.all(handlers.map(async (handler) => handler(event)));
  }

  get inboundSize(): number {
    return this.inboundQueue.size();
  }

  get outboundSize(): number {
    return this.outboundQueue.size();
  }
}
