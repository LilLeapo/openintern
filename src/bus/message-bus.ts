import { AsyncQueue } from "./async-queue.js";
import type { InboundMessage, OutboundMessage, SubagentTaskEvent } from "./events.js";

export class MessageBus {
  private readonly inboundQueue = new AsyncQueue<InboundMessage>();
  private readonly outboundQueue = new AsyncQueue<OutboundMessage>();
  private readonly subagentHandlers = new Set<
    (event: SubagentTaskEvent) => void | Promise<void>
  >();

  async publishInbound(message: InboundMessage): Promise<void> {
    this.inboundQueue.enqueue({
      ...message,
      timestamp: message.timestamp ?? new Date(),
      media: message.media ?? [],
      metadata: message.metadata ?? {},
    });
  }

  async consumeInbound(timeoutMs?: number): Promise<InboundMessage | null> {
    return this.inboundQueue.dequeue(timeoutMs);
  }

  async publishOutbound(message: OutboundMessage): Promise<void> {
    this.outboundQueue.enqueue({
      ...message,
      media: message.media ?? [],
      metadata: message.metadata ?? {},
    });
  }

  async consumeOutbound(timeoutMs?: number): Promise<OutboundMessage | null> {
    return this.outboundQueue.dequeue(timeoutMs);
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

  get inboundSize(): number {
    return this.inboundQueue.size();
  }

  get outboundSize(): number {
    return this.outboundQueue.size();
  }
}
