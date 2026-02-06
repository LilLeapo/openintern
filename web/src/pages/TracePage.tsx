/**
 * TracePage - run trace visualization page
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TraceView } from '../components/Trace';
import { apiClient } from '../api/client';
import { useSSE } from '../hooks/useSSE';
import type { Event } from '../types/events';
import styles from './Pages.module.css';

export function TracePage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // SSE for real-time updates
  const { events: sseEvents } = useSSE(runId ?? null);

  // Load initial events
  useEffect(() => {
    if (!runId) return;

    const loadEvents = async () => {
      try {
        const data = await apiClient.getEvents(runId);
        setEvents(data);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to load'));
      } finally {
        setLoading(false);
      }
    };

    void loadEvents();
  }, [runId]);

  // Merge SSE events
  useEffect(() => {
    if (sseEvents.length > 0) {
      setEvents((prev) => {
        const existingIds = new Set(prev.map((e) => e.span_id));
        const newEvents = sseEvents.filter((e) => !existingIds.has(e.span_id));
        return [...prev, ...newEvents];
      });
    }
  }, [sseEvents]);

  if (!runId) {
    return <div className={styles.error}>Run ID is required</div>;
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backButton} onClick={() => navigate(-1)}>
          Back
        </button>
        <h1>Run Trace</h1>
      </header>
      <main className={styles.main}>
        {loading ? (
          <div className={styles.loading}>Loading trace...</div>
        ) : error ? (
          <div className={styles.error}>{error.message}</div>
        ) : (
          <TraceView events={events} runId={runId} />
        )}
      </main>
    </div>
  );
}
