/**
 * API Client - handles all REST API calls to the backend
 */

import type { RunMeta, BlackboardMemory } from '../types';
import type {
  CreateRunResponse,
  ListRunsResponse,
  GetRunEventsResponse,
  Event,
} from '../types/events';

interface ScopeConfig {
  orgId: string;
  userId: string;
  projectId?: string;
}

export class APIClient {
  private baseURL: string;
  private scope: ScopeConfig;

  constructor(
    baseURL: string = '',
    scope: ScopeConfig = {
      orgId: import.meta.env.VITE_ORG_ID ?? 'org_default',
      userId: import.meta.env.VITE_USER_ID ?? 'user_default',
      ...(import.meta.env.VITE_PROJECT_ID
        ? { projectId: import.meta.env.VITE_PROJECT_ID }
        : {}),
    }
  ) {
    this.baseURL = baseURL;
    this.scope = scope;
  }

  private buildScopeHeaders(): Record<string, string> {
    return {
      'x-org-id': this.scope.orgId,
      'x-user-id': this.scope.userId,
      ...(this.scope.projectId ? { 'x-project-id': this.scope.projectId } : {}),
    };
  }

  /**
   * Create a new run
   */
  async createRun(sessionKey: string, input: string): Promise<CreateRunResponse> {
    const response = await fetch(`${this.baseURL}/api/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.buildScopeHeaders(),
      },
      body: JSON.stringify({
        org_id: this.scope.orgId,
        user_id: this.scope.userId,
        ...(this.scope.projectId ? { project_id: this.scope.projectId } : {}),
        session_key: sessionKey,
        input,
      }),
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
    const response = await fetch(`${this.baseURL}/api/runs/${runId}`, {
      headers: this.buildScopeHeaders(),
    });

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
    const response = await fetch(url, {
      headers: this.buildScopeHeaders(),
    });

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

    const response = await fetch(url, {
      headers: this.buildScopeHeaders(),
    });

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
      headers: this.buildScopeHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new APIError(error.error?.message ?? 'Failed to cancel run', response.status);
    }
  }

  /**
   * List blackboard memories for a group
   */
  async getBlackboard(groupId: string): Promise<BlackboardMemory[]> {
    const response = await fetch(
      `${this.baseURL}/api/groups/${groupId}/blackboard`,
      { headers: this.buildScopeHeaders() }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new APIError(error.error?.message ?? 'Failed to get blackboard', response.status);
    }

    const data: { memories: BlackboardMemory[] } = await response.json();
    return data.memories;
  }

  /**
   * Get a single blackboard memory
   */
  async getBlackboardMemory(groupId: string, memoryId: string): Promise<BlackboardMemory> {
    const response = await fetch(
      `${this.baseURL}/api/groups/${groupId}/blackboard/${memoryId}`,
      { headers: this.buildScopeHeaders() }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new APIError(error.error?.message ?? 'Failed to get memory', response.status);
    }

    return response.json();
  }

  /**
   * Write to group blackboard
   */
  async writeBlackboard(
    groupId: string,
    body: {
      type: string;
      text: string;
      role_id: string;
      metadata?: Record<string, unknown>;
      importance?: number;
    }
  ): Promise<{ id: string }> {
    const response = await fetch(
      `${this.baseURL}/api/groups/${groupId}/blackboard`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.buildScopeHeaders(),
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new APIError(error.error?.message ?? 'Failed to write to blackboard', response.status);
    }

    return response.json();
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
