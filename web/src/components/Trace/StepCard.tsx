/**
 * StepCard - displays a single step in the trace
 */

import { useState } from 'react';
import { ToolCallCard } from './ToolCallCard';
import type { Event } from '../../types/events';
import styles from './Trace.module.css';

export interface StepCardProps {
  stepNumber: number;
  events: Event[];
}

export function StepCard({ stepNumber, events }: StepCardProps) {
  const [expanded, setExpanded] = useState(true);

  // Find step events
  const stepCompleted = events.find((e) => e.type === 'step.completed');
  const llmCalled = events.find((e) => e.type === 'llm.called');

  // Find tool calls and results
  const toolCalls = events.filter((e) => e.type === 'tool.called');
  const toolResults = events.filter((e) => e.type === 'tool.result');

  // Get duration
  const duration = stepCompleted?.type === 'step.completed'
    ? stepCompleted.payload.duration_ms
    : undefined;

  // Get result type
  const resultType = stepCompleted?.type === 'step.completed'
    ? stepCompleted.payload.resultType
    : undefined;

  return (
    <div className={styles.stepCard}>
      <div
        className={styles.stepHeader}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={styles.stepNumber}>Step {stepNumber}</span>
        {resultType && (
          <span className={`${styles.resultType} ${styles[resultType]}`}>
            {resultType.replace('_', ' ')}
          </span>
        )}
        {duration !== undefined && (
          <span className={styles.duration}>{duration}ms</span>
        )}
        <span className={styles.expandIcon}>
          {expanded ? '-' : '+'}
        </span>
      </div>

      {expanded && (
        <div className={styles.stepContent}>
          {/* LLM info */}
          {llmCalled?.type === 'llm.called' && (
            <div className={styles.llmInfo}>
              <span>Model: {llmCalled.payload.model}</span>
              <span>Tokens: {llmCalled.payload.totalTokens}</span>
            </div>
          )}

          {/* Tool calls */}
          {toolCalls.map((tc, idx) => {
            if (tc.type !== 'tool.called') return null;
            const result = toolResults[idx];
            const resultPayload = result?.type === 'tool.result'
              ? result.payload
              : undefined;

            return (
              <ToolCallCard
                key={tc.span_id}
                toolName={tc.payload.toolName}
                args={tc.payload.args}
                result={resultPayload?.result}
                isError={resultPayload?.isError}
                error={resultPayload?.error}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
