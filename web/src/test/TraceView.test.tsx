/**
 * TraceView component tests
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TraceView } from '../components/Trace/TraceView';
import type { Event } from '../types/events';

describe('TraceView', () => {
  const baseEvent = {
    v: 1 as const,
    session_key: 's_test',
    run_id: 'run_abc',
    agent_id: 'main',
    step_id: 'step_0',
    span_id: 'sp_1',
    parent_span_id: null,
    redaction: { contains_secrets: false },
  };

  it('renders run header', () => {
    const events: Event[] = [];

    render(<TraceView events={events} runId="run_abc" />);

    expect(screen.getByText(/run_abc/i)).toBeInTheDocument();
  });

  it('shows running status when no completion event', () => {
    const events: Event[] = [
      {
        ...baseEvent,
        ts: new Date().toISOString(),
        type: 'run.started',
        payload: { input: 'Test input' },
      },
    ];

    render(<TraceView events={events} runId="run_abc" />);

    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('renders tool result card in trace step', () => {
    const events: Event[] = [
      {
        ...baseEvent,
        ts: new Date().toISOString(),
        type: 'run.started',
        payload: { input: 'use a tool' },
      },
      {
        ...baseEvent,
        ts: new Date().toISOString(),
        type: 'tool.called',
        payload: {
          toolName: 'memory_search',
          args: { query: 'deploy checklist' },
        },
      },
      {
        ...baseEvent,
        ts: new Date().toISOString(),
        span_id: 'sp_2',
        type: 'tool.result',
        payload: {
          toolName: 'memory_search',
          result: [{ id: 'mem_1' }],
          isError: false,
        },
      },
      {
        ...baseEvent,
        ts: new Date().toISOString(),
        span_id: 'sp_3',
        type: 'step.completed',
        payload: {
          stepNumber: 1,
          resultType: 'tool_call',
          duration_ms: 42,
        },
      },
      {
        ...baseEvent,
        ts: new Date().toISOString(),
        span_id: 'sp_4',
        type: 'run.completed',
        payload: {
          output: 'done',
          duration_ms: 70,
        },
      },
    ];

    render(<TraceView events={events} runId="run_abc" />);

    expect(screen.getByText('memory_search')).toBeInTheDocument();
    expect(screen.getByText('Result')).toBeInTheDocument();
    expect(screen.getByText(/deploy checklist/i)).toBeInTheDocument();
  });

  it('renders failed status and error message', () => {
    const events: Event[] = [
      {
        ...baseEvent,
        ts: new Date().toISOString(),
        type: 'run.started',
        payload: { input: 'bad request' },
      },
      {
        ...baseEvent,
        ts: new Date().toISOString(),
        span_id: 'sp_5',
        type: 'run.failed',
        payload: {
          error: {
            code: 'AGENT_ERROR',
            message: 'Tool timed out',
          },
        },
      },
    ];

    render(<TraceView events={events} runId="run_abc" />);

    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText(/Tool timed out/i)).toBeInTheDocument();
  });
});
