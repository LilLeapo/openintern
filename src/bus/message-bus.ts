import { AsyncQueue } from "./async-queue.js";
import type { InboundMessage, OutboundMessage } from "./events.js";

export class MessageBus {
  private readonly inboundQueue = new AsyncQueue<InboundMessage>();
  private readonly outboundQueue = new AsyncQueue<OutboundMessage>();

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

  get inboundSize(): number {
    return this.inboundQueue.size();
  }

  get outboundSize(): number {
    return this.outboundQueue.size();
  }
}

