/**
 * SSE Client - handles Server-Sent Events for real-time updates
 */

import type { Event } from '../types/events';

export type SSEEventHandler = (event: Event) => void;
export type SSEErrorHandler = (error: Error) => void;
export type SSEConnectedHandler = () => void;

export interface SSEClientOptions {
  onEvent?: SSEEventHandler;
  onError?: SSEErrorHandler;
  onConnected?: SSEConnectedHandler;
  onDisconnected?: () => void;
}

interface ScopeQuery {
  orgId: string;
  userId: string;
  projectId: string | null;
}

const TENANT_SCOPE_STORAGE_KEY = 'openintern.tenant_scope';

function readScopeForSSE(): ScopeQuery {
  const fallback: ScopeQuery = {
    orgId: import.meta.env.VITE_ORG_ID ?? 'org_default',
    userId: import.meta.env.VITE_USER_ID ?? 'user_default',
    projectId: import.meta.env.VITE_PROJECT_ID ?? null,
  };

  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(TENANT_SCOPE_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return fallback;
    }
    const record = parsed as Record<string, unknown>;
    const orgId = typeof record['orgId'] === 'string' && record['orgId'].trim().length > 0
      ? record['orgId'].trim()
      : fallback.orgId;
    const userId = typeof record['userId'] === 'string' && record['userId'].trim().length > 0
      ? record['userId'].trim()
      : fallback.userId;
    const projectId = typeof record['projectId'] === 'string'
      ? (record['projectId'].trim() || null)
      : fallback.projectId;
    return { orgId, userId, projectId };
  } catch {
    return fallback;
  }
}

export class SSEClient {
  private eventSource: EventSource | null = null;
  private options: SSEClientOptions;
  private baseURL: string;

  constructor(baseURL: string = '', options: SSEClientOptions = {}) {
    this.baseURL = baseURL;
    this.options = options;
  }

  /**
   * Connect to SSE stream for a run
   */
  connect(runId: string): void {
    if (this.eventSource) {
      this.disconnect();
    }

    const scope = readScopeForSSE();
    const params = new URLSearchParams({
      org_id: scope.orgId,
      user_id: scope.userId,
    });
    if (scope.projectId) {
      params.set('project_id', scope.projectId);
    }
    const url = `${this.baseURL}/api/runs/${runId}/stream?${params.toString()}`;
    this.eventSource = new EventSource(url);

    // Handle connection open
    this.eventSource.onopen = () => {
      this.options.onConnected?.();
    };

    // Handle run events
    this.eventSource.addEventListener('run.event', (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as Event;
        this.options.onEvent?.(event);
      } catch (error) {
        console.error('Failed to parse SSE event:', error);
      }
    });

    // Handle ping events (keep-alive)
    this.eventSource.addEventListener('ping', () => {
      // Ping received, connection is alive
    });

    // Handle errors
    this.eventSource.onerror = () => {
      this.options.onError?.(new Error('SSE connection error'));
    };
  }

  /**
   * Disconnect from SSE stream
   */
  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.options.onDisconnected?.();
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.eventSource !== null &&
           this.eventSource.readyState === EventSource.OPEN;
  }
}
