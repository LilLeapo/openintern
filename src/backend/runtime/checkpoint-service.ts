import { RunRepository } from './run-repository.js';

export class CheckpointService {
  constructor(private readonly runs: RunRepository) {}

  async save(
    runId: string,
    agentId: string,
    stepId: string,
    state: Record<string, unknown>
  ): Promise<void> {
    await this.runs.createCheckpoint(runId, agentId, stepId, state);
  }

  async loadLatest(
    runId: string,
    agentId: string
  ): Promise<{ stepId: string; state: Record<string, unknown> } | null> {
    return this.runs.getLatestCheckpoint(runId, agentId);
  }
}
