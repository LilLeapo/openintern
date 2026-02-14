import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { resolveRequestScope } from '../runtime/request-scope.js';
import { UploadService } from '../runtime/upload-service.js';

export interface UploadsRouterConfig {
  uploadService: UploadService;
}

const UploadRequestSchema = z.object({
  file_name: z.string().min(1).max(255),
  mime_type: z.string().min(1).max(120),
  content_base64: z.string().min(1),
});

export function createUploadsRouter(config: UploadsRouterConfig): Router {
  const router = Router();

  router.post('/uploads', (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const parsed = UploadRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          const firstError = parsed.error.errors[0];
          throw new ValidationError(
            firstError?.message ?? 'Invalid upload request',
            firstError?.path.join('.') ?? 'body'
          );
        }
        const scope = resolveRequestScope(req);
        const saved = await config.uploadService.save(scope, {
          fileName: parsed.data.file_name,
          mimeType: parsed.data.mime_type,
          contentBase64: parsed.data.content_base64,
        });
        logger.info('Upload saved', {
          uploadId: saved.upload_id,
          size: saved.size_bytes,
          kind: saved.kind,
        });
        res.status(201).json(saved);
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get('/uploads/:upload_id', (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const uploadId = req.params['upload_id'];
        if (!uploadId) {
          throw new ValidationError('upload_id is required', 'upload_id');
        }
        const scope = resolveRequestScope(req);
        const payload = await config.uploadService.getBuffer(uploadId, scope);
        const disposition = payload.meta.kind === 'image' ? 'inline' : 'attachment';
        const encodedName = encodeURIComponent(payload.meta.file_name);
        res.setHeader('Content-Type', payload.meta.mime_type);
        res.setHeader('Content-Length', String(payload.data.byteLength));
        res.setHeader(
          'Content-Disposition',
          `${disposition}; filename*=UTF-8''${encodedName}`
        );
        res.send(payload.data);
      } catch (error) {
        next(error);
      }
    })();
  });

  return router;
}
