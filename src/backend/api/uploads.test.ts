import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentError } from '../../utils/errors.js';
import { createUploadsRouter } from './uploads.js';
import type { UploadService } from '../runtime/upload-service.js';

function withScope(req: request.Test): request.Test {
  return req
    .set('x-org-id', 'org_test')
    .set('x-user-id', 'user_test');
}

describe('Uploads API', () => {
  let app: express.Express;
  let uploadService: {
    save: ReturnType<typeof vi.fn>;
    getBuffer: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    uploadService = {
      save: vi.fn(),
      getBuffer: vi.fn(),
    };

    app = express();
    app.use(express.json({ limit: '20mb' }));
    app.use('/api', createUploadsRouter({ uploadService: uploadService as unknown as UploadService }));
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      if (err instanceof AgentError) {
        res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
        return;
      }
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    });
  });

  it('creates uploads and returns metadata', async () => {
    uploadService.save.mockResolvedValue({
      upload_id: 'upl_abc123',
      file_name: 'demo.txt',
      mime_type: 'text/plain',
      size_bytes: 5,
      kind: 'text',
      created_at: new Date().toISOString(),
      download_url: '/api/uploads/upl_abc123',
      sha256: 'abc',
      text_excerpt: 'hello',
    });

    const response = await withScope(request(app)
      .post('/api/uploads')
      .send({
        file_name: 'demo.txt',
        mime_type: 'text/plain',
        content_base64: 'aGVsbG8=',
      }));

    expect(response.status).toBe(201);
    expect(response.body.upload_id).toBe('upl_abc123');
    expect(uploadService.save).toHaveBeenCalledTimes(1);
  });

  it('serves uploaded bytes', async () => {
    uploadService.getBuffer.mockResolvedValue({
      meta: {
        upload_id: 'upl_abc123',
        file_name: 'image.png',
        mime_type: 'image/png',
        size_bytes: 4,
        kind: 'image',
        created_at: new Date().toISOString(),
        download_url: '/api/uploads/upl_abc123',
        sha256: 'abc',
      },
      data: Buffer.from([1, 2, 3, 4]),
    });

    const response = await withScope(request(app).get('/api/uploads/upl_abc123'));
    expect(response.status).toBe(200);
    expect(response.header['content-type']).toContain('image/png');
    expect(Buffer.isBuffer(response.body)).toBe(true);
  });

  it('validates missing scope headers', async () => {
    const response = await request(app)
      .post('/api/uploads')
      .send({
        file_name: 'demo.txt',
        mime_type: 'text/plain',
        content_base64: 'aGVsbG8=',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
