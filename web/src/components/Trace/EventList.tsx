/**
 * EventList - displays a list of events
 */

import type { Event } from '../../types/events';
import styles from './Trace.module.css';

export interface EventListProps {
  events: Event[];
  filter?: string;
}

export function EventList({ events, filter }: EventListProps) {
  const filteredEvents = filter
    ? events.filter((e) => e.type === filter)
    : events;

  return (
    <div className={styles.eventList}>
      {filteredEvents.map((event) => (
        <EventItem key={event.span_id} event={event} />
      ))}
    </div>
  );
}

function EventItem({ event }: { event: Event }) {
  const time = new Date(event.ts).toLocaleTimeString();

  return (
    <div className={styles.eventItem}>
      <div className={styles.eventHeader}>
        <span className={`${styles.eventType} ${styles[event.type.replace('.', '_')]}`}>
          {event.type}
        </span>
        <span className={styles.eventTime}>{time}</span>
      </div>
      <div className={styles.eventDetails}>
        <span>Step: {event.step_id}</span>
        <span>Span: {event.span_id}</span>
      </div>
    </div>
  );
}
