/**
 * API Client tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIClient, APIError } from '../api/client';

describe('APIClient', () => {
  let client: APIClient;

  beforeEach(() => {
    client = new APIClient('http://localhost:3000');
    vi.resetAllMocks();
  });

  describe('createRun', () => {
    it('creates a run successfully', async () => {
      const mockResponse = {
        run_id: 'run_abc123',
        status: 'pending',
        created_at: new Date().toISOString(),
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.createRun('s_test', 'Hello');

      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/runs',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('throws APIError on failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: { message: 'Invalid input' },
        }),
      });

      await expect(client.createRun('s_test', '')).rejects.toThrow(APIError);
    });

    it('includes llm_config when provided', async () => {
      const mockResponse = {
        run_id: 'run_cfg123',
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      global.fetch = fetchMock;

      await client.createRun('s_test', 'Hello', {
        provider: 'anthropic',
        model: 'MiniMax-M2.1',
        base_url: 'https://proxy.example/v1',
      });

      const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(requestInit.body)) as Record<string, unknown>;
      expect(body['llm_config']).toEqual({
        provider: 'anthropic',
        model: 'MiniMax-M2.1',
        base_url: 'https://proxy.example/v1',
      });
    });
  });

  describe('uploadAttachment', () => {
    it('uploads file and maps payload', async () => {
      const mockResponse = {
        upload_id: 'upl_abc123',
        file_name: 'hello.txt',
        mime_type: 'text/plain',
        size_bytes: 5,
        kind: 'text',
        created_at: new Date().toISOString(),
        download_url: '/api/uploads/upl_abc123',
        sha256: 'deadbeef',
        text_excerpt: 'hello',
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      global.fetch = fetchMock;

      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
      const result = await client.uploadAttachment(file);

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/api/uploads',
        expect.objectContaining({
          method: 'POST',
        })
      );
      const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(String(requestInit.body)) as Record<string, string>;
      expect(body['file_name']).toBe('hello.txt');
      expect(body['mime_type']).toBe('text/plain');
      expect(body['content_base64']).toBe('aGVsbG8=');

      expect(result.uploadId).toBe('upl_abc123');
      expect(result.downloadUrl).toContain('/api/uploads/upl_abc123');
      expect(result.downloadUrl).toContain('org_id=');
      expect(result.textExcerpt).toBe('hello');
    });
  });
});
