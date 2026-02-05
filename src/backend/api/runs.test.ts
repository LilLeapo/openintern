/**
 * Runs API tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../server.js';
import type { CreateRunResponse, ListRunsResponse, ErrorResponse } from '../../types/api.js';

describe('Runs API', () => {
  let app: ReturnType<typeof createApp>['app'];
  let sseManager: ReturnType<typeof createApp>['sseManager'];
  let testDir: string;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'runs-api-test-'));
    const result = createApp({ baseDir: testDir });
    app = result.app;
    sseManager = result.sseManager;
  });

  afterEach(async () => {
    sseManager.shutdown();
    // Clean up test directory
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

  describe('POST /api/runs', () => {
    it('should create a new run', async () => {
      const response = await request(app)
        .post('/api/runs')
        .send({
          session_key: 's_test',
          input: 'Hello, agent!',
        });

      const body = response.body as CreateRunResponse;
      expect(response.status).toBe(201);
      expect(body).toHaveProperty('run_id');
      expect(body.run_id).toMatch(/^run_/);
      expect(body.status).toBe('pending');
      expect(body).toHaveProperty('created_at');
    });

    it('should accept optional agent_id', async () => {
      const response = await request(app)
        .post('/api/runs')
        .send({
          session_key: 's_test',
          input: 'Hello!',
          agent_id: 'custom_agent',
        });

      expect(response.status).toBe(201);
    });

    it('should reject invalid session_key format', async () => {
      const response = await request(app)
        .post('/api/runs')
        .send({
          session_key: 'invalid',
          input: 'Hello!',
        });

      const body = response.body as ErrorResponse;
      expect(response.status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject empty input', async () => {
      const response = await request(app)
        .post('/api/runs')
        .send({
          session_key: 's_test',
          input: '',
        });

      expect(response.status).toBe(400);
    });

    it('should reject missing fields', async () => {
      const response = await request(app)
        .post('/api/runs')
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/runs/:run_id', () => {
    it('should return 404 for non-existent run', async () => {
      const response = await request(app).get('/api/runs/run_nonexistent');

      const body = response.body as ErrorResponse;
      expect(response.status).toBe(404);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return run details from queue', async () => {
      // Create a run first
      const createResponse = await request(app)
        .post('/api/runs')
        .send({
          session_key: 's_test',
          input: 'Test input',
        });

      const createBody = createResponse.body as CreateRunResponse;
      const runId = createBody.run_id;

      const response = await request(app).get(`/api/runs/${runId}`);

      const body = response.body as { run_id: string };
      expect(response.status).toBe(200);
      expect(body.run_id).toBe(runId);
    });
  });

  describe('GET /api/sessions/:session_key/runs', () => {
    it('should return empty list for new session', async () => {
      const response = await request(app).get('/api/sessions/s_new/runs');

      const body = response.body as ListRunsResponse;
      expect(response.status).toBe(200);
      expect(body.runs).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/sessions/s_test/runs')
        .query({ page: 1, limit: 10 });

      const body = response.body as ListRunsResponse;
      expect(response.status).toBe(200);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(10);
    });

    it('should reject invalid page number', async () => {
      const response = await request(app)
        .get('/api/sessions/s_test/runs')
        .query({ page: 0 });

      expect(response.status).toBe(400);
    });

    it('should reject invalid limit', async () => {
      const response = await request(app)
        .get('/api/sessions/s_test/runs')
        .query({ limit: 200 });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/runs/:run_id/events', () => {
    it('should return 404 for non-existent run', async () => {
      const response = await request(app).get('/api/runs/run_nonexistent/events');

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/runs/:run_id/cancel', () => {
    it('should return 400 for already completed run', async () => {
      // Create a run first (it will be auto-processed and completed)
      const createResponse = await request(app)
        .post('/api/runs')
        .send({
          session_key: 's_test',
          input: 'Test input',
        });

      const createBody = createResponse.body as CreateRunResponse;
      const runId = createBody.run_id;

      // Try to cancel the already completed run
      const response = await request(app).post(`/api/runs/${runId}/cancel`);

      const body = response.body as ErrorResponse;
      expect(response.status).toBe(400);
      expect(body.error.code).toBe('RUN_ALREADY_FINISHED');
    });

    it('should return 404 for non-existent run', async () => {
      const response = await request(app).post('/api/runs/run_nonexistent/cancel');

      expect(response.status).toBe(404);
    });
  });
});
