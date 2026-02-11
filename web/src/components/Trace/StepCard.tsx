/**
 * StepCard - displays a single step in the trace
 */

import { useState } from 'react';
import { ToolCallCard } from './ToolCallCard';
import type { Event } from '../../types/events';
import { useLocaleText } from '../../i18n/useLocaleText';
import styles from './Trace.module.css';

export interface StepCardProps {
  stepId: string;
  stepNumber: number;
  events: Event[];
}

export function StepCard({ stepId, stepNumber, events }: StepCardProps) {
  const { t } = useLocaleText();
  const [expanded, setExpanded] = useState(true);

  // Find step events
  const stepCompleted = events.find((e) => e.type === 'step.completed');
  const llmCalled = [...events].reverse().find((e) => e.type === 'llm.called');

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

  const resultByParentSpan = new Map<string, Event>();
  for (const resultEvent of toolResults) {
    if (resultEvent.type === 'tool.result' && resultEvent.parent_span_id) {
      resultByParentSpan.set(resultEvent.parent_span_id, resultEvent);
    }
  }

  return (
    <div className={styles.stepCard}>
      <button
        type="button"
        className={styles.stepHeader}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={styles.stepNumber}>{t(`Step ${stepNumber}`, `步骤 ${stepNumber}`)}</span>
        <span className={styles.stepId}>{stepId}</span>
        {resultType && (
          <span className={`${styles.resultType} ${styles[resultType]}`}>
            {resultType.replace('_', ' ')}
          </span>
        )}
        {duration !== undefined && (
          <span className={styles.duration}>{duration}ms</span>
        )}
        <span className={styles.expandIcon}>
          {expanded ? t('Collapse', '收起') : t('Expand', '展开')}
        </span>
      </button>

      {expanded && (
        <div className={styles.stepContent}>
          {/* LLM info */}
          {llmCalled?.type === 'llm.called' && (
            <div className={styles.llmInfo}>
              <span>{t('Model:', '模型：')} {llmCalled.payload.model}</span>
              <span>{t('Tokens:', 'Token：')} {llmCalled.payload.totalTokens}</span>
            </div>
          )}

          {/* Tool calls */}
          {toolCalls.map((tc, idx) => {
            if (tc.type !== 'tool.called') return null;
            const result = resultByParentSpan.get(tc.span_id) ?? toolResults[idx];
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
