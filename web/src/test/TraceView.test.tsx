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
});
