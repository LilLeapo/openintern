import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NotFoundError } from '../../utils/errors.js';
import { UploadService, buildAttachmentPromptSuffix } from './upload-service.js';

const scope = {
  orgId: 'org_test',
  userId: 'user_test',
  projectId: null,
} as const;

const otherScope = {
  orgId: 'org_other',
  userId: 'user_other',
  projectId: null,
} as const;

describe('UploadService', () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    while (cleanupPaths.length > 0) {
      const next = cleanupPaths.pop();
      if (next) {
        await fs.rm(next, { recursive: true, force: true });
      }
    }
  });

  it('saves and reads text uploads with preview', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-service-'));
    cleanupPaths.push(baseDir);
    const service = new UploadService(baseDir);

    const saved = await service.save(scope, {
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      contentBase64: Buffer.from('hello world', 'utf8').toString('base64'),
    });

    expect(saved.upload_id).toMatch(/^upl_/);
    expect(saved.kind).toBe('text');
    expect(saved.text_excerpt).toContain('hello world');

    const fetched = await service.get(saved.upload_id, scope);
    expect(fetched.file_name).toBe('notes.txt');
    expect(fetched.download_url).toBe(`/api/uploads/${saved.upload_id}`);

    const withBytes = await service.getBuffer(saved.upload_id, scope);
    expect(withBytes.data.toString('utf8')).toBe('hello world');
  });

  it('enforces scope isolation for uploads', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-service-'));
    cleanupPaths.push(baseDir);
    const service = new UploadService(baseDir);

    const saved = await service.save(scope, {
      fileName: 'private.txt',
      mimeType: 'text/plain',
      contentBase64: Buffer.from('sensitive', 'utf8').toString('base64'),
    });

    await expect(service.get(saved.upload_id, otherScope)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('builds attachment prompt suffix', () => {
    const text = buildAttachmentPromptSuffix([
      {
        upload_id: 'upl_text',
        file_name: 'spec.md',
        mime_type: 'text/markdown',
        size_bytes: 1024,
        kind: 'text',
        created_at: new Date().toISOString(),
        download_url: '/api/uploads/upl_text',
        sha256: 'abc',
        text_excerpt: 'hello',
      },
    ]);

    expect(text).toContain('Attachments provided by user');
    expect(text).toContain('spec.md');
    expect(text).toContain('Text excerpt');
  });
});
