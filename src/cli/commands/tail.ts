/**
 * CLI Command: agent tail
 *
 * Stream events from a run in real-time
 */

import * as output from '../utils/output.js';

export interface TailOptions {
  format: 'json' | 'pretty';
}

function scopeHeaders(): Record<string, string> {
  const orgId = process.env['AGENT_ORG_ID'] ?? 'org_default';
  const userId = process.env['AGENT_USER_ID'] ?? 'user_default';
  const projectId = process.env['AGENT_PROJECT_ID'];
  return {
    'x-org-id': orgId,
    'x-user-id': userId,
    ...(projectId ? { 'x-project-id': projectId } : {}),
  };
}

/**
 * Execute the tail command
 */
export async function tailCommand(
  runId: string,
  options: TailOptions
): Promise<void> {
  const baseUrl = process.env['AGENT_API_URL'] ?? 'http://localhost:3000';

  // Validate run_id format
  if (!runId.startsWith('run_')) {
    output.error('Invalid run_id format. Expected: run_<id>');
    process.exit(1);
  }

  try {
    output.info(`Streaming events for ${runId}...`);
    output.print('');

    const response = await fetch(`${baseUrl}/api/runs/${runId}/stream`, {
      headers: scopeHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        output.error(`Run not found: ${runId}`);
        process.exit(1);
      }
      throw new Error(`HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      output.print('');
      output.info('Stream closed');
      process.exit(0);
    });

    // Use async iterator for the stream
    for await (const chunk of response.body) {
      const bytes = chunk as Uint8Array;
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        processSSELine(line, options.format);
      }
    }

    output.print('');
    output.info('Stream ended');
  } catch (err) {
    if (
      err instanceof TypeError &&
      (err.message.includes('fetch') || err.message.includes('ECONNREFUSED'))
    ) {
      output.error('Backend server not running');
      output.info('Run "agent dev" first to start the server');
      process.exit(1);
    }
    output.error(
      `Failed to stream: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
}

/**
 * Process a single SSE line
 */
function processSSELine(line: string, format: 'json' | 'pretty'): void {
  if (!line.startsWith('data: ')) {
    return;
  }

  const data = line.slice(6);
  if (!data || data === '[DONE]') {
    return;
  }

  try {
    const event = JSON.parse(data) as {
      ts: string;
      type: string;
      step_id?: string;
      payload?: Record<string, unknown>;
    };

    if (format === 'json') {
      output.print(JSON.stringify(event));
    } else {
      output.print(output.formatEvent(event));
    }
  } catch {
    // Skip non-JSON lines (like ping events)
  }
}
