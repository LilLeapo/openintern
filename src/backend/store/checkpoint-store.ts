/**
 * CheckpointStore - Save/load agent state snapshots for recovery
 *
 * Storage:
 * - data/sessions/<session_key>/runs/<run_id>/checkpoint.latest.json
 * - data/sessions/<session_key>/runs/<run_id>/checkpoint/<step_id>.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { CheckpointSchema, type Checkpoint } from '../../types/checkpoint.js';
import { CheckpointStoreError } from '../../utils/errors.js';

/**
 * CheckpointStore class for managing agent state snapshots
 */
export class CheckpointStore {
  private readonly baseDir: string;
  private readonly latestPath: string;
  private readonly historyDir: string;

  constructor(
    private readonly sessionKey: string,
    private readonly runId: string,
    private readonly dataDir: string = 'data'
  ) {
    this.baseDir = path.join(
      dataDir,
      'sessions',
      sessionKey,
      'runs',
      runId
    );
    this.latestPath = path.join(this.baseDir, 'checkpoint.latest.json');
    this.historyDir = path.join(this.baseDir, 'checkpoint');
  }

  /**
   * Get the latest checkpoint file path
   */
  getLatestPath(): string {
    return this.latestPath;
  }

  /**
   * Get the history directory path
   */
  getHistoryDir(): string {
    return this.historyDir;
  }

  /**
   * Ensure the base directory exists
   */
  private async ensureBaseDir(): Promise<void> {
    await fs.promises.mkdir(this.baseDir, { recursive: true });
  }

  /**
   * Ensure the history directory exists
   */
  private async ensureHistoryDir(): Promise<void> {
    await fs.promises.mkdir(this.historyDir, { recursive: true });
  }

  /**
   * Validate a checkpoint using Zod schema
   */
  private validateCheckpoint(checkpoint: Checkpoint): void {
    const result = CheckpointSchema.safeParse(checkpoint);
    if (!result.success) {
      throw new CheckpointStoreError('Invalid checkpoint format', {
        errors: result.error.errors,
        runId: checkpoint.run_id,
      });
    }
  }

  /**
   * Save the latest checkpoint (overwrites previous)
   */
  async saveLatest(checkpoint: Checkpoint): Promise<void> {
    this.validateCheckpoint(checkpoint);

    try {
      await this.ensureBaseDir();
      const content = JSON.stringify(checkpoint, null, 2);
      await fs.promises.writeFile(this.latestPath, content, {
        encoding: 'utf-8',
      });
    } catch (error) {
      if (error instanceof CheckpointStoreError) {
        throw error;
      }
      throw new CheckpointStoreError('Failed to save latest checkpoint', {
        filePath: this.latestPath,
        runId: checkpoint.run_id,
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Load the latest checkpoint
   * @returns Checkpoint or null if not found
   */
  async loadLatest(): Promise<Checkpoint | null> {
    try {
      const content = await fs.promises.readFile(this.latestPath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;
      const result = CheckpointSchema.safeParse(parsed);

      if (!result.success) {
        throw new CheckpointStoreError('Invalid checkpoint format in file', {
          filePath: this.latestPath,
          errors: result.error.errors,
        });
      }

      return result.data;
    } catch (error) {
      if (error instanceof CheckpointStoreError) {
        throw error;
      }
      // File not found - return null
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return null;
      }
      throw new CheckpointStoreError('Failed to load latest checkpoint', {
        filePath: this.latestPath,
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Save a historical checkpoint snapshot
   */
  async saveHistorical(checkpoint: Checkpoint, stepId: string): Promise<void> {
    this.validateCheckpoint(checkpoint);

    // Validate stepId format
    if (!/^step_[0-9]+$/.test(stepId)) {
      throw new CheckpointStoreError('Invalid step ID format', {
        stepId,
        expected: 'step_NNNN',
      });
    }

    try {
      await this.ensureHistoryDir();
      const filePath = path.join(this.historyDir, `${stepId}.json`);
      const content = JSON.stringify(checkpoint, null, 2);
      await fs.promises.writeFile(filePath, content, { encoding: 'utf-8' });
    } catch (error) {
      if (error instanceof CheckpointStoreError) {
        throw error;
      }
      throw new CheckpointStoreError('Failed to save historical checkpoint', {
        stepId,
        runId: checkpoint.run_id,
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Load a historical checkpoint by step ID
   * @returns Checkpoint or null if not found
   */
  async loadHistorical(stepId: string): Promise<Checkpoint | null> {
    const filePath = path.join(this.historyDir, `${stepId}.json`);

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as unknown;
      const result = CheckpointSchema.safeParse(parsed);

      if (!result.success) {
        throw new CheckpointStoreError('Invalid checkpoint format in file', {
          filePath,
          errors: result.error.errors,
        });
      }

      return result.data;
    } catch (error) {
      if (error instanceof CheckpointStoreError) {
        throw error;
      }
      // File not found - return null
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return null;
      }
      throw new CheckpointStoreError('Failed to load historical checkpoint', {
        filePath,
        stepId,
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * List all historical checkpoint step IDs
   */
  async listHistorical(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this.historyDir);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''))
        .sort();
    } catch (error) {
      // Directory not found - return empty
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return [];
      }
      throw new CheckpointStoreError('Failed to list historical checkpoints', {
        historyDir: this.historyDir,
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if latest checkpoint exists
   */
  async hasLatest(): Promise<boolean> {
    try {
      await fs.promises.access(this.latestPath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete the latest checkpoint
   */
  async deleteLatest(): Promise<void> {
    try {
      await fs.promises.unlink(this.latestPath);
    } catch (error) {
      // Ignore if file doesn't exist
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return;
      }
      throw new CheckpointStoreError('Failed to delete latest checkpoint', {
        filePath: this.latestPath,
        originalError: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
