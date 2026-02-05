/**
 * CheckpointStore tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CheckpointStore } from './checkpoint-store.js';
import type { Checkpoint } from '../../types/checkpoint.js';

describe('CheckpointStore', () => {
  let tempDir: string;
  let store: CheckpointStore;

  const createTestCheckpoint = (
    overrides: Partial<Checkpoint> = {}
  ): Checkpoint => ({
    v: 1,
    created_at: new Date().toISOString(),
    run_id: 'run_abc123',
    step_id: 'step_0001',
    state: {
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
      context: { key: 'value' },
    },
    ...overrides,
  });

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'checkpoint-store-test-')
    );
    store = new CheckpointStore('s_test', 'run_abc123', tempDir);
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('saveLatest', () => {
    it('should save latest checkpoint', async () => {
      const checkpoint = createTestCheckpoint();
      await store.saveLatest(checkpoint);

      const latestPath = store.getLatestPath();
      const content = await fs.promises.readFile(latestPath, 'utf-8');
      const saved = JSON.parse(content) as Checkpoint;

      expect(saved).toEqual(checkpoint);
    });

    it('should create directory if not exists', async () => {
      const checkpoint = createTestCheckpoint();
      await store.saveLatest(checkpoint);

      const hasLatest = await store.hasLatest();
      expect(hasLatest).toBe(true);
    });

    it('should overwrite previous checkpoint', async () => {
      const checkpoint1 = createTestCheckpoint({ step_id: 'step_0001' });
      const checkpoint2 = createTestCheckpoint({ step_id: 'step_0002' });

      await store.saveLatest(checkpoint1);
      await store.saveLatest(checkpoint2);

      const loaded = await store.loadLatest();
      expect(loaded?.step_id).toBe('step_0002');
    });

    it('should reject invalid checkpoint', async () => {
      const invalidCheckpoint = {
        v: 1,
        run_id: 'invalid',
      } as unknown as Checkpoint;

      await expect(store.saveLatest(invalidCheckpoint)).rejects.toThrow(
        'Invalid checkpoint format'
      );
    });
  });

  describe('loadLatest', () => {
    it('should load latest checkpoint', async () => {
      const checkpoint = createTestCheckpoint();
      await store.saveLatest(checkpoint);

      const loaded = await store.loadLatest();
      expect(loaded).toEqual(checkpoint);
    });

    it('should return null if not exists', async () => {
      const loaded = await store.loadLatest();
      expect(loaded).toBeNull();
    });

    it('should throw on corrupted file', async () => {
      // Create directory and write corrupted file
      const latestPath = store.getLatestPath();
      await fs.promises.mkdir(path.dirname(latestPath), { recursive: true });
      await fs.promises.writeFile(latestPath, 'invalid json', 'utf-8');

      await expect(store.loadLatest()).rejects.toThrow();
    });
  });

  describe('saveHistorical', () => {
    it('should save historical checkpoint', async () => {
      const checkpoint = createTestCheckpoint();
      await store.saveHistorical(checkpoint, 'step_0001');

      const historyDir = store.getHistoryDir();
      const filePath = path.join(historyDir, 'step_0001.json');
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const saved = JSON.parse(content) as Checkpoint;

      expect(saved).toEqual(checkpoint);
    });

    it('should create history directory if not exists', async () => {
      const checkpoint = createTestCheckpoint();
      await store.saveHistorical(checkpoint, 'step_0001');

      const historyDir = store.getHistoryDir();
      const stat = await fs.promises.stat(historyDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should reject invalid step ID format', async () => {
      const checkpoint = createTestCheckpoint();

      await expect(
        store.saveHistorical(checkpoint, 'invalid_step')
      ).rejects.toThrow('Invalid step ID format');
    });

    it('should save multiple historical checkpoints', async () => {
      const checkpoint1 = createTestCheckpoint({ step_id: 'step_0001' });
      const checkpoint2 = createTestCheckpoint({ step_id: 'step_0002' });

      await store.saveHistorical(checkpoint1, 'step_0001');
      await store.saveHistorical(checkpoint2, 'step_0002');

      const list = await store.listHistorical();
      expect(list).toHaveLength(2);
      expect(list).toContain('step_0001');
      expect(list).toContain('step_0002');
    });
  });

  describe('loadHistorical', () => {
    it('should load historical checkpoint', async () => {
      const checkpoint = createTestCheckpoint();
      await store.saveHistorical(checkpoint, 'step_0001');

      const loaded = await store.loadHistorical('step_0001');
      expect(loaded).toEqual(checkpoint);
    });

    it('should return null if not exists', async () => {
      const loaded = await store.loadHistorical('step_9999');
      expect(loaded).toBeNull();
    });
  });

  describe('listHistorical', () => {
    it('should list all historical checkpoints', async () => {
      const checkpoint = createTestCheckpoint();

      await store.saveHistorical(checkpoint, 'step_0001');
      await store.saveHistorical(checkpoint, 'step_0005');
      await store.saveHistorical(checkpoint, 'step_0010');

      const list = await store.listHistorical();
      expect(list).toEqual(['step_0001', 'step_0005', 'step_0010']);
    });

    it('should return empty array if no history', async () => {
      const list = await store.listHistorical();
      expect(list).toEqual([]);
    });
  });

  describe('hasLatest', () => {
    it('should return false if no checkpoint', async () => {
      const has = await store.hasLatest();
      expect(has).toBe(false);
    });

    it('should return true after save', async () => {
      await store.saveLatest(createTestCheckpoint());
      const has = await store.hasLatest();
      expect(has).toBe(true);
    });
  });

  describe('deleteLatest', () => {
    it('should delete latest checkpoint', async () => {
      await store.saveLatest(createTestCheckpoint());
      expect(await store.hasLatest()).toBe(true);

      await store.deleteLatest();
      expect(await store.hasLatest()).toBe(false);
    });

    it('should not throw if checkpoint does not exist', async () => {
      await expect(store.deleteLatest()).resolves.not.toThrow();
    });
  });
});
