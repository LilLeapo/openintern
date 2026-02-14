import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../utils/errors.js';
import { generateUploadId } from '../../utils/ids.js';
import type { ScopeContext } from './scope.js';

export type UploadKind = 'image' | 'text' | 'binary';

export interface UploadSaveInput {
  fileName: string;
  mimeType: string;
  contentBase64: string;
}

export interface UploadReference {
  upload_id: string;
}

export interface UploadRecord {
  upload_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  kind: UploadKind;
  created_at: string;
  download_url: string;
  sha256: string;
  text_excerpt?: string;
}

interface UploadServiceOptions {
  maxBytes?: number;
  textPreviewChars?: number;
}

interface StoredUploadMeta {
  upload_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  kind: UploadKind;
  created_at: string;
  sha256: string;
  scope: {
    org_id: string;
    user_id: string;
    project_id: string | null;
  };
  storage_name: string;
  text_excerpt?: string | undefined;
}

const StoredUploadMetaSchema: z.ZodType<StoredUploadMeta> = z.object({
  upload_id: z.string().min(1),
  file_name: z.string().min(1),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  kind: z.enum(['image', 'text', 'binary']),
  created_at: z.string().datetime(),
  sha256: z.string().min(1),
  scope: z.object({
    org_id: z.string().min(1),
    user_id: z.string().min(1),
    project_id: z.string().nullable(),
  }),
  storage_name: z.string().min(1),
  text_excerpt: z.string().optional(),
});

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TEXT_PREVIEW_CHARS = 1800;

const MIME_FALLBACK_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'text/plain': '.txt',
  'application/json': '.json',
  'text/markdown': '.md',
};

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.csv', '.tsv', '.xml', '.html',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp',
  '.log', '.ini', '.cfg', '.toml', '.sql', '.sh', '.rb', '.php',
]);

function normalizeFileName(raw: string): string {
  const trimmed = raw.trim();
  const basename = trimmed.split(/[\\/]/).pop() ?? '';
  const sanitized = basename.replace(/[^A-Za-z0-9._()\- ]+/g, '_').slice(0, 140);
  return sanitized.length > 0 ? sanitized : 'upload.bin';
}

function inferExtension(fileName: string, mimeType: string): string {
  const fromName = path.extname(fileName).toLowerCase();
  if (fromName && /^[.a-z0-9]+$/.test(fromName) && fromName.length <= 12) {
    return fromName;
  }
  const fromMime = MIME_FALLBACK_EXT[mimeType.toLowerCase()];
  return fromMime ?? '.bin';
}

function detectUploadKind(mimeType: string, fileName: string): UploadKind {
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime.startsWith('image/')) {
    return 'image';
  }
  if (
    lowerMime.startsWith('text/') ||
    lowerMime === 'application/json' ||
    lowerMime === 'application/xml' ||
    lowerMime === 'application/x-yaml' ||
    lowerMime === 'application/javascript'
  ) {
    return 'text';
  }
  const ext = path.extname(fileName).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) {
    return 'text';
  }
  return 'binary';
}

function decodeBase64(contentBase64: string): Buffer {
  const normalized = contentBase64.replace(/\s+/g, '');
  if (normalized.length === 0) {
    throw new ValidationError('content_base64 is required', 'content_base64');
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    throw new ValidationError('content_base64 contains invalid characters', 'content_base64');
  }
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length === 0) {
    throw new ValidationError('content_base64 cannot be decoded', 'content_base64');
  }
  const expected = normalized.replace(/=+$/, '');
  const actual = decoded.toString('base64').replace(/=+$/, '');
  if (expected !== actual) {
    throw new ValidationError('content_base64 is invalid', 'content_base64');
  }
  return decoded;
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes}B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)}KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
}

function extractTextExcerpt(buffer: Buffer, maxChars: number): string | undefined {
  const text = buffer.toString('utf8').replace(/\u0000/g, '').trim();
  if (text.length === 0) {
    return undefined;
  }
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

export function buildAttachmentPromptSuffix(attachments: UploadRecord[]): string {
  if (attachments.length === 0) {
    return '';
  }
  const lines: string[] = [];
  lines.push('');
  lines.push('---');
  lines.push('Attachments provided by user:');
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i]!;
    lines.push(
      `${i + 1}. ${a.file_name} (${a.mime_type}, ${formatBytes(a.size_bytes)}), upload_id=${a.upload_id}`
    );
    lines.push(`   Download: ${a.download_url}`);
    if (a.kind === 'image') {
      lines.push('   Note: This is an image. If image understanding is required, ask user for details.');
    } else if (a.text_excerpt) {
      lines.push('   Text excerpt:');
      for (const excerptLine of a.text_excerpt.split('\n')) {
        lines.push(`   ${excerptLine}`);
      }
    } else {
      lines.push('   Note: Binary file, no inline preview.');
    }
  }
  return lines.join('\n');
}

export class UploadService {
  private readonly uploadsDir: string;
  private readonly maxBytes: number;
  private readonly textPreviewChars: number;

  constructor(baseDir: string, options: UploadServiceOptions = {}) {
    this.uploadsDir = path.join(baseDir, 'uploads');
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.textPreviewChars = options.textPreviewChars ?? DEFAULT_TEXT_PREVIEW_CHARS;
  }

  private metaPath(uploadId: string): string {
    return path.join(this.uploadsDir, `${uploadId}.json`);
  }

  private dataPath(storageName: string): string {
    return path.join(this.uploadsDir, storageName);
  }

  private toRecord(meta: StoredUploadMeta): UploadRecord {
    return {
      upload_id: meta.upload_id,
      file_name: meta.file_name,
      mime_type: meta.mime_type,
      size_bytes: meta.size_bytes,
      kind: meta.kind,
      created_at: meta.created_at,
      download_url: `/api/uploads/${meta.upload_id}`,
      sha256: meta.sha256,
      ...(meta.text_excerpt ? { text_excerpt: meta.text_excerpt } : {}),
    };
  }

  private ensureScope(meta: StoredUploadMeta, scope: ScopeContext): void {
    if (
      meta.scope.org_id !== scope.orgId ||
      meta.scope.user_id !== scope.userId ||
      meta.scope.project_id !== scope.projectId
    ) {
      throw new NotFoundError('Upload', meta.upload_id);
    }
  }

  private async readMeta(uploadId: string): Promise<StoredUploadMeta> {
    let raw = '';
    try {
      raw = await fs.readFile(this.metaPath(uploadId), 'utf8');
    } catch {
      throw new NotFoundError('Upload', uploadId);
    }
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(raw) as unknown;
    } catch {
      throw new NotFoundError('Upload', uploadId);
    }
    const parsed = StoredUploadMetaSchema.safeParse(parsedRaw);
    if (!parsed.success) {
      throw new NotFoundError('Upload', uploadId);
    }
    return parsed.data;
  }

  async save(scope: ScopeContext, input: UploadSaveInput): Promise<UploadRecord> {
    const fileName = normalizeFileName(input.fileName);
    const mimeType = input.mimeType.trim().toLowerCase() || 'application/octet-stream';
    const bytes = decodeBase64(input.contentBase64);
    if (bytes.length > this.maxBytes) {
      throw new ValidationError(
        `File exceeds max size ${this.maxBytes} bytes`,
        'content_base64'
      );
    }

    const uploadId = generateUploadId();
    const extension = inferExtension(fileName, mimeType);
    const storageName = `${uploadId}${extension}`;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const kind = detectUploadKind(mimeType, fileName);
    const textExcerpt =
      kind === 'text' ? extractTextExcerpt(bytes, this.textPreviewChars) : undefined;
    const createdAt = new Date().toISOString();

    const meta: StoredUploadMeta = {
      upload_id: uploadId,
      file_name: fileName,
      mime_type: mimeType,
      size_bytes: bytes.length,
      kind,
      created_at: createdAt,
      sha256,
      scope: {
        org_id: scope.orgId,
        user_id: scope.userId,
        project_id: scope.projectId,
      },
      storage_name: storageName,
      ...(textExcerpt ? { text_excerpt: textExcerpt } : {}),
    };

    await fs.mkdir(this.uploadsDir, { recursive: true });
    await fs.writeFile(this.dataPath(storageName), bytes);
    await fs.writeFile(this.metaPath(uploadId), JSON.stringify(meta), 'utf8');
    return this.toRecord(meta);
  }

  async get(uploadId: string, scope: ScopeContext): Promise<UploadRecord> {
    const meta = await this.readMeta(uploadId);
    this.ensureScope(meta, scope);
    return this.toRecord(meta);
  }

  async getBuffer(uploadId: string, scope: ScopeContext): Promise<{ meta: UploadRecord; data: Buffer }> {
    const meta = await this.readMeta(uploadId);
    this.ensureScope(meta, scope);
    let data: Buffer;
    try {
      data = await fs.readFile(this.dataPath(meta.storage_name));
    } catch {
      throw new NotFoundError('Upload', uploadId);
    }
    return {
      meta: this.toRecord(meta),
      data,
    };
  }

  async resolveMany(scope: ScopeContext, refs: UploadReference[]): Promise<UploadRecord[]> {
    const records: UploadRecord[] = [];
    for (const ref of refs) {
      records.push(await this.get(ref.upload_id, scope));
    }
    return records;
  }
}
