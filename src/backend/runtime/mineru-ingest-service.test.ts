import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentError } from '../../utils/errors.js';
import { MineruIngestService } from './mineru-ingest-service.js';
import type { MemoryService } from './memory-service.js';
import type { MineruClient } from './mineru-client.js';

type MockMemoryService = {
  replace_archival_document: ReturnType<typeof vi.fn>;
};

type MockMineruClient = {
  createExtractTask: ReturnType<typeof vi.fn>;
  waitForTask: ReturnType<typeof vi.fn>;
  downloadFile: ReturnType<typeof vi.fn>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function createService(options: {
  enabled?: boolean;
  memoryService?: MockMemoryService;
  client?: MockMineruClient | null;
} = {}): {
  service: MineruIngestService;
  memoryService: MockMemoryService;
  client: MockMineruClient;
} {
  const memoryService = options.memoryService ?? {
    replace_archival_document: vi.fn(),
  };
  const client = options.client ?? {
    createExtractTask: vi.fn(),
    waitForTask: vi.fn(),
    downloadFile: vi.fn(),
  };
  const service = new MineruIngestService(
    memoryService as unknown as MemoryService,
    (options.client === null ? null : client) as unknown as MineruClient | null,
    {
      enabled: options.enabled ?? true,
      pollIntervalMs: 1000,
      maxPollAttempts: 10,
      defaultModelVersion: 'pipeline',
    }
  );
  return { service, memoryService, client };
}

describe('MineruIngestService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects when service is disabled', async () => {
    const { service } = createService({ enabled: false });

    await expect(
      service.ingestPdf({
        scope: { orgId: 'org_1', userId: 'user_1', projectId: 'project_1' },
        file_url: 'https://example.com/a.pdf',
      })
    ).rejects.toMatchObject({
      code: 'MINERU_DISABLED',
    });
  });

  it('rejects invalid file_url', async () => {
    const { service } = createService();

    await expect(
      service.ingestPdf({
        scope: { orgId: 'org_1', userId: 'user_1', projectId: 'project_1' },
        file_url: 'not-a-url',
      })
    ).rejects.toMatchObject({
      code: 'MINERU_FILE_URL_INVALID',
    });
  });

  it('ingests pdf and writes archival chunks', async () => {
    const { service, client, memoryService } = createService();
    client.createExtractTask.mockResolvedValue({
      task_id: 'task_1',
      data_id: 'data_1',
      state: 'running',
      err_msg: null,
      full_zip_url: null,
      output_path: null,
    });
    client.waitForTask.mockResolvedValue({
      task_id: 'task_1',
      data_id: 'data_1',
      state: 'done',
      err_msg: null,
      full_zip_url: 'https://example.com/result.zip',
      output_path: '/tmp/output',
    });
    client.downloadFile.mockResolvedValue(Buffer.from('zip-bytes'));
    memoryService.replace_archival_document.mockResolvedValue({
      id: 'mem_1',
      replaced: 1,
    });

    vi.spyOn(service as unknown as { extractZipOutput: () => Promise<unknown> }, 'extractZipOutput').mockResolvedValue({
      markdown: '# MinerU result',
      contentList: [
        {
          type: 'text',
          text: 'This is extracted from MinerU.',
          page_idx: 1,
        },
      ],
      outputName: 'sample',
    });

    const result = await service.ingestPdf({
      scope: { orgId: 'org_1', userId: 'user_1', projectId: 'project_1' },
      file_url: 'https://example.com/a.pdf',
      metadata: { from: 'test' },
    });

    const createTaskInput = asRecord(client.createExtractTask.mock.calls[0]?.[0]);
    expect(createTaskInput['fileUrl']).toBe('https://example.com/a.pdf');
    expect(asRecord(createTaskInput['options'])['model_version']).toBe('pipeline');
    expect(memoryService.replace_archival_document).toHaveBeenCalledTimes(1);
    const writeInput = asRecord(memoryService.replace_archival_document.mock.calls[0]?.[0]);
    expect(asRecord(writeInput['source'])).toMatchObject({
      source_type: 'pdf_mineru',
      source_key: 'mineru:data_1',
    });
    expect(asRecord(writeInput['metadata'])).toMatchObject({
      source_url: 'https://example.com/a.pdf',
      task_id: 'task_1',
      data_id: 'data_1',
      from: 'test',
    });
    const chunks = Array.isArray(writeInput['chunks']) ? writeInput['chunks'] : [];
    expect(chunks.length).toBeGreaterThan(0);
    const firstChunk = asRecord(chunks[0]);
    expect(asRecord(firstChunk['metadata'])['source_type']).toBe('pdf_mineru');
    expect(result).toMatchObject({
      memory_id: 'mem_1',
      source_key: 'mineru:data_1',
      task_id: 'task_1',
      data_id: 'data_1',
      replaced: 1,
    });
    expect(result.chunk_count).toBeGreaterThan(0);
  });

  it('throws when task result misses full_zip_url', async () => {
    const { service, client } = createService();
    client.createExtractTask.mockResolvedValue({
      task_id: 'task_1',
      data_id: 'data_1',
      state: 'running',
      err_msg: null,
      full_zip_url: null,
      output_path: null,
    });
    client.waitForTask.mockResolvedValue({
      task_id: 'task_1',
      data_id: 'data_1',
      state: 'done',
      err_msg: null,
      full_zip_url: null,
      output_path: null,
    });

    let caught: unknown;
    try {
      await service.ingestPdf({
        scope: { orgId: 'org_1', userId: 'user_1', projectId: 'project_1' },
        file_url: 'https://example.com/a.pdf',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AgentError);
    expect(caught).toMatchObject({ code: 'MINERU_RESULT_MISSING' });
  });
});
