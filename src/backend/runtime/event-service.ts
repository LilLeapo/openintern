import type { Event } from '../../types/events.js';
import type { ScopeContext } from './scope.js';
import { RunRepository } from './run-repository.js';

export interface EventPage {
  events: Event[];
  next_cursor: string | null;
}

export class EventService {
  constructor(private readonly runs: RunRepository) {}

  async write(event: Event): Promise<number> {
    return this.runs.appendEvent(event);
  }

  async writeBatch(events: Event[]): Promise<number[]> {
    return this.runs.appendEvents(events);
  }

  async list(
    runId: string,
    scope: ScopeContext,
    cursor: string | undefined,
    limit: number
  ): Promise<EventPage> {
    const page = await this.runs.getRunEvents(runId, scope, cursor, limit);
    return {
      events: page.items,
      next_cursor: page.nextCursor,
    };
  }
}
