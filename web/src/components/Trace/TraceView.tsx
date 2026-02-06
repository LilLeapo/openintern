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
}

export function TraceView({ events, runId }: TraceViewProps) {
  // Group events by step
  const stepGroups = useMemo(() => {
    const groups = new Map<string, Event[]>();

    for (const event of events) {
      const stepId = event.step_id;
      if (!groups.has(stepId)) {
        groups.set(stepId, []);
      }
      groups.get(stepId)?.push(event);
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

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
        {stepGroups.map(([stepId, stepEvents]) => {
          const stepNum = parseInt(stepId.replace('step_', ''), 10);
          return (
            <StepCard
              key={stepId}
              stepNumber={stepNum}
              events={stepEvents}
            />
          );
        })}
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
