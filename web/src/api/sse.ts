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

    const params = new URLSearchParams({
      org_id: import.meta.env.VITE_ORG_ID ?? 'org_default',
      user_id: import.meta.env.VITE_USER_ID ?? 'user_default',
    });
    if (import.meta.env.VITE_PROJECT_ID) {
      params.set('project_id', import.meta.env.VITE_PROJECT_ID);
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
