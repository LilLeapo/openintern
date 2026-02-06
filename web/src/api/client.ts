/**
 * API Client - handles all REST API calls to the backend
 */

import type { RunMeta } from '../types';
import type {
  CreateRunResponse,
  ListRunsResponse,
  GetRunEventsResponse,
  Event,
} from '../types/events';

export class APIClient {
  private baseURL: string;

  constructor(baseURL: string = '') {
    this.baseURL = baseURL;
  }

  /**
   * Create a new run
   */
  async createRun(sessionKey: string, input: string): Promise<CreateRunResponse> {
    const response = await fetch(`${this.baseURL}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_key: sessionKey, input }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new APIError(error.error?.message ?? 'Failed to create run', response.status);
    }

    return response.json();
  }

  /**
   * Get run details
   */
  async getRun(runId: string): Promise<RunMeta> {
    const response = await fetch(`${this.baseURL}/api/runs/${runId}`);

    if (!response.ok) {
      const error = await response.json();
      throw new APIError(error.error?.message ?? 'Failed to get run', response.status);
    }

    return response.json();
  }

  /**
   * List runs for a session
   */
  async listRuns(
    sessionKey: string,
    page: number = 1,
    limit: number = 20
  ): Promise<ListRunsResponse> {
    const url = `${this.baseURL}/api/sessions/${sessionKey}/runs?page=${page}&limit=${limit}`;
    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.json();
      throw new APIError(error.error?.message ?? 'Failed to list runs', response.status);
    }

    return response.json();
  }

  /**
   * Get events for a run
   */
  async getEvents(runId: string, type?: string): Promise<Event[]> {
    let url = `${this.baseURL}/api/runs/${runId}/events`;
    if (type) {
      url += `?type=${encodeURIComponent(type)}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.json();
      throw new APIError(error.error?.message ?? 'Failed to get events', response.status);
    }

    const data: GetRunEventsResponse = await response.json();
    return data.events;
  }

  /**
   * Cancel a run
   */
  async cancelRun(runId: string): Promise<void> {
    const response = await fetch(`${this.baseURL}/api/runs/${runId}/cancel`, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new APIError(error.error?.message ?? 'Failed to cancel run', response.status);
    }
  }
}

/**
 * API Error class
 */
export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// Default client instance
export const apiClient = new APIClient();
