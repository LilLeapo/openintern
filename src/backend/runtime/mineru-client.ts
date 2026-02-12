import { logger } from '../../utils/logger.js';
import type { MineruExtractOptions, MineruModelVersion, MineruTaskState } from '../../types/mineru.js';

interface MineruTokenCache {
  value: string;
  expireAtMs: number;
}

interface MineruRequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
  retryCount?: number;
}

export interface MineruClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  uidToken?: string;
}

export interface MineruCreateTaskInput {
  fileUrl: string;
  options?: MineruExtractOptions;
}

export interface MineruTaskInfo {
  task_id: string;
  data_id: string | null;
  state: MineruTaskState;
  err_msg: string | null;
  full_zip_url: string | null;
  output_path: string | null;
}

export interface MineruWaitTaskOptions {
  intervalMs: number;
  maxAttempts: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function normalizeTaskState(value: string | null): MineruTaskState {
  const normalized = (value ?? '').toLowerCase();
  if (
    normalized === 'pending' ||
    normalized === 'running' ||
    normalized === 'converting' ||
    normalized === 'done' ||
    normalized === 'failed'
  ) {
    return normalized;
  }
  if (normalized === 'success' || normalized === 'completed') {
    return 'done';
  }
  if (normalized === 'error') {
    return 'failed';
  }
  return 'running';
}

export class MineruApiError extends Error {
  constructor(
    message: string,
    public readonly details: {
      code?: number | null;
      httpStatus?: number;
      retryable: boolean;
    }
  ) {
    super(message);
    this.name = 'MineruApiError';
  }
}

export class MineruClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly uidToken: string | null;
  private tokenCache: MineruTokenCache | null = null;

  constructor(private readonly config: MineruClientConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://mineru.net/api/v4').replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? 20000;
    this.maxRetries = Math.max(0, Math.min(config.maxRetries ?? 3, 6));
    this.uidToken = readString(config.uidToken);
  }

  async createExtractTask(input: MineruCreateTaskInput): Promise<MineruTaskInfo> {
    const options = input.options ?? {};
    const modelVersion = options.model_version ?? 'pipeline';
    const body: Record<string, unknown> = {
      url: input.fileUrl,
      model_version: modelVersion as MineruModelVersion,
      is_ocr: options.is_ocr ?? false,
      enable_formula: options.enable_formula ?? true,
      enable_table: options.enable_table ?? true,
      ...(options.language ? { language: options.language } : {}),
      ...(options.page_ranges ? { page_ranges: options.page_ranges } : {}),
      ...(options.no_cache !== undefined ? { no_cache: options.no_cache } : {}),
      ...(options.cache_tolerance !== undefined
        ? { cache_tolerance: options.cache_tolerance }
        : {}),
      ...(options.data_id ? { data_id: options.data_id } : {}),
    };
    const data = await this.request('POST', '/extract/task', { body });
    const task = asRecord(data['task'] ?? data);
    return this.mapTask(task);
  }

  async getExtractTask(taskId: string): Promise<MineruTaskInfo> {
    const data = await this.request(
      'GET',
      `/extract/task/${encodeURIComponent(taskId)}`
    );
    const task = asRecord(data['task'] ?? data);
    return this.mapTask(task);
  }

  async waitForTask(taskId: string, options: MineruWaitTaskOptions): Promise<MineruTaskInfo> {
    const attempts = Math.max(1, options.maxAttempts);
    const intervalMs = Math.max(1000, options.intervalMs);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const task = await this.getExtractTask(taskId);
      if (task.state === 'done') {
        return task;
      }
      if (task.state === 'failed') {
        throw new MineruApiError(
          task.err_msg ?? 'MinerU task failed',
          { retryable: false }
        );
      }
      await sleep(intervalMs);
    }
    throw new MineruApiError(
      `MinerU task timeout after ${attempts} attempts`,
      { retryable: false }
    );
  }

  async downloadFile(url: string): Promise<Buffer> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new MineruApiError(
          `MinerU file download HTTP ${response.status}`,
          {
            httpStatus: response.status,
            retryable: isRetryableStatus(response.status),
          }
        );
      }
      const bytes = await response.arrayBuffer();
      return Buffer.from(bytes);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    options: MineruRequestOptions = {}
  ): Promise<Record<string, unknown>> {
    const retries = Math.max(0, Math.min(options.retryCount ?? this.maxRetries, 6));
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const token = await this.getApiToken();
        const data = await this.doRequest(method, path, options, token);
        return data;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        lastError = err;
        const retryable = err instanceof MineruApiError ? err.details.retryable : true;
        if (!retryable || attempt >= retries) {
          break;
        }
        const delay = Math.min(3000, 200 * 2 ** attempt);
        await sleep(delay);
      }
    }

    throw lastError ?? new Error('MinerU request failed');
  }

  private async doRequest(
    method: 'GET' | 'POST',
    path: string,
    options: MineruRequestOptions,
    token: string | null
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined) {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(this.uidToken ? { token: this.uidToken } : {}),
        },
        ...(method === 'POST' ? { body: JSON.stringify(options.body ?? {}) } : {}),
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new MineruApiError(
          `MinerU HTTP ${response.status}`,
          {
            code: readNumber(payload['code']),
            httpStatus: response.status,
            retryable: isRetryableStatus(response.status),
          }
        );
      }

      const code = readNumber(payload['code']) ?? 0;
      if (code !== 0) {
        throw new MineruApiError(
          `MinerU API error: ${readString(payload['msg']) ?? 'unknown error'}`,
          {
            code,
            httpStatus: response.status,
            retryable: code === 429 || code >= 500,
          }
        );
      }

      return asRecord(payload['data'] ?? payload);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async getApiToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && now < this.tokenCache.expireAtMs - 60000) {
      return this.tokenCache.value;
    }

    const path = this.config.apiKey.startsWith('sk-')
      ? '/token/get_token_by_sk'
      : '/token/get_token';
    const body = this.config.apiKey.startsWith('sk-')
      ? { sk: this.config.apiKey }
      : { ak: this.config.apiKey };
    const data = await this.doRequest('POST', path, { body }, null);

    const token = readString(data['token']);
    if (!token) {
      throw new MineruApiError('token missing in response', {
        retryable: false,
      });
    }
    const expireSeconds = readNumber(data['expired']) ?? 7200;
    this.tokenCache = {
      value: token,
      expireAtMs: now + expireSeconds * 1000,
    };
    logger.debug('MinerU API token refreshed', { expireSeconds });
    return token;
  }

  private mapTask(value: Record<string, unknown>): MineruTaskInfo {
    const taskId = readString(value['task_id']) ?? '';
    if (!taskId) {
      throw new MineruApiError('task_id missing in MinerU task payload', {
        retryable: false,
      });
    }
    return {
      task_id: taskId,
      data_id: readString(value['data_id']),
      state: normalizeTaskState(readString(value['state'])),
      err_msg: readString(value['err_msg']),
      full_zip_url: readString(value['full_zip_url']),
      output_path: readString(value['output_path']),
    };
  }
}
