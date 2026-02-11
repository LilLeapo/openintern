/**
 * EventList - displays a list of events
 */

import type { Event } from '../../types/events';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './Trace.module.css';

export interface EventListProps {
  events: Event[];
  filter?: string;
}

export function EventList({ events, filter }: EventListProps) {
  const { t } = useLocaleText();
  const filteredEvents = filter
    ? events.filter((e) => e.type === filter)
    : events;

  if (filteredEvents.length === 0) {
    return <div className={styles.emptySteps}>{t('No events found.', '未找到事件。')}</div>;
  }

  return (
    <div className={styles.eventList}>
      {filteredEvents.map((event) => (
        <EventItem key={event.span_id} event={event} />
      ))}
    </div>
  );
}

function EventItem({ event }: { event: Event }) {
  const { t } = useLocaleText();
  const time = new Date(event.ts).toLocaleTimeString();
  const payloadPreview = JSON.stringify(event.payload)
    .replaceAll('"', '')
    .slice(0, 140);

  return (
    <div className={styles.eventItem}>
      <div className={styles.eventHeader}>
        <span className={`${styles.eventType} ${styles[event.type.replace('.', '_')]}`}>
          {event.type}
        </span>
        <span className={styles.eventTime}>{time}</span>
      </div>
      <div className={styles.eventDetails}>
        <span>{t('Step:', '步骤：')} {event.step_id}</span>
        <span>{t('Span:', '跨度：')} {event.span_id}</span>
      </div>
      <p className={styles.eventPayload}>{payloadPreview}</p>
    </div>
  );
}
