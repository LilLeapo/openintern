/**
 * TraceView - main trace visualization component
 */

import { useMemo } from 'react';
import { StepCard } from './StepCard';
import type { Event } from '../../types/events';
import styles from './Trace.module.css';

export interface TraceViewProps {
  events: Event[];
  runId: string;
  eventFilter?: Event['type'] | 'all';
}

function parseStepIndex(stepId: string): number {
  const numeric = Number.parseInt(stepId.replace('step_', ''), 10);
  return Number.isNaN(numeric) ? Number.MAX_SAFE_INTEGER : numeric;
}

export function TraceView({ events, runId, eventFilter = 'all' }: TraceViewProps) {
  const visibleEvents = useMemo(
    () => (eventFilter === 'all' ? events : events.filter(event => event.type === eventFilter)),
    [events, eventFilter],
  );

  // Group visible events by step
  const stepGroups = useMemo(() => {
    const groups = new Map<string, Event[]>();

    for (const event of visibleEvents) {
      const stepId = event.step_id;
      if (!groups.has(stepId)) {
        groups.set(stepId, []);
      }
      groups.get(stepId)?.push(event);
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => parseStepIndex(a) - parseStepIndex(b));
  }, [visibleEvents]);

  // Find run events
  const runStarted = events.find((e) => e.type === 'run.started');
  const runCompleted = events.find((e) => e.type === 'run.completed');
  const runFailed = events.find((e) => e.type === 'run.failed');

  const status = runFailed
    ? 'failed'
    : runCompleted
      ? 'completed'
      : 'running';

  return (
    <div className={styles.traceView}>
      <div className={styles.traceHeader}>
        <h2>Run: {runId}</h2>
        <span className={`${styles.status} ${styles[status]}`}>
          {status}
        </span>
      </div>

      {runStarted?.type === 'run.started' && (
        <div className={styles.runInput}>
          <strong>Input:</strong> {runStarted.payload.input}
        </div>
      )}

      <div className={styles.stepsContainer}>
        {stepGroups.length === 0 ? (
          <div className={styles.emptySteps}>No events for this filter.</div>
        ) : (
          stepGroups.map(([stepId, stepEvents]) => {
            const firstCompleted = stepEvents.find(
              event => event.type === 'step.completed',
            );
            const stepNum =
              firstCompleted?.type === 'step.completed'
                ? firstCompleted.payload.stepNumber
                : parseStepIndex(stepId);
            return (
              <StepCard
                key={stepId}
                stepId={stepId}
                stepNumber={stepNum}
                events={stepEvents}
              />
            );
          })
        )}
      </div>

      {runCompleted?.type === 'run.completed' && (
        <div className={styles.runOutput}>
          <strong>Output:</strong> {runCompleted.payload.output}
        </div>
      )}

      {runFailed?.type === 'run.failed' && (
        <div className={styles.runError}>
          <strong>Error:</strong> {runFailed.payload.error.message}
        </div>
      )}
    </div>
  );
}
