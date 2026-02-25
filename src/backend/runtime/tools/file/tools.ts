import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { RuntimeTool, ToolContext } from '../_helpers.js';
import { extractString, resolveWithinWorkDir } from '../_helpers.js';
import { ToolError } from '../../../../utils/errors.js';

const READ_FILE_MAX_CHARS = 120_000;

function truncateContent(content: string): { content: string; truncated: boolean; originalLength: number } {
  if (content.length <= READ_FILE_MAX_CHARS) {
    return { content, truncated: false, originalLength: content.length };
  }
  return {
    content: `${content.slice(0, READ_FILE_MAX_CHARS)}\n\n[truncated: original_length=${content.length}]`,
    truncated: true,
    originalLength: content.length,
  };
}

async function tryExtractPdfWithPdftotext(resolvedPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'pdftotext',
      ['-enc', 'UTF-8', '-layout', resolvedPath, '-'],
      { timeout: 20_000, maxBuffer: 1024 * 1024 * 10 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const text = stdout.trim();
        resolve(text.length > 0 ? text : null);
      },
    );
  });
}

async function tryExtractPdfWithStrings(resolvedPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'strings',
      ['-n', '6', resolvedPath],
      { timeout: 20_000, maxBuffer: 1024 * 1024 * 10 },
      (err, stdout) => {
        if (err) {
          resolve(null);
          return;
        }
        const lines = stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        const text = lines.join('\n');
        resolve(text.length > 0 ? text : null);
      },
    );
  });
}

async function extractPdfText(resolvedPath: string): Promise<{ content: string; method: 'pdftotext' | 'strings' }> {
  const byPdftotext = await tryExtractPdfWithPdftotext(resolvedPath);
  if (byPdftotext) {
    return { content: byPdftotext, method: 'pdftotext' };
  }
  const byStrings = await tryExtractPdfWithStrings(resolvedPath);
  if (byStrings) {
    return { content: byStrings, method: 'strings' };
  }
  throw new ToolError(
    'Failed to extract readable text from PDF. Try mineru_ingest_pdf for structured PDF parsing.',
    'read_file'
  );
}

export function register(ctx: ToolContext): RuntimeTool[] {
  return [
    {
      name: 'read_file',
      description: 'Read a file from the workspace. Text files are returned as UTF-8; PDF files are text-extracted.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      source: 'builtin',
      metadata: { risk_level: 'low', mutating: false, supports_parallel: true },
      handler: async (params) => {
        const filePath = extractString(params['path']);
        if (!filePath) throw new ToolError('path is required', 'read_file');
        const resolved = resolveWithinWorkDir(ctx.workDir, filePath, 'read_file');
        const ext = path.extname(resolved).toLowerCase();

        if (ext === '.pdf') {
          const extracted = await extractPdfText(resolved);
          const clipped = truncateContent(extracted.content);
          return {
            path: filePath,
            content: clipped.content,
            extracted_from: 'pdf',
            extraction_method: extracted.method,
            ...(clipped.truncated
              ? {
                  truncated: true,
                  original_length: clipped.originalLength,
                }
              : {}),
          };
        }

        const content = await fs.promises.readFile(resolved, 'utf-8');
        const clipped = truncateContent(content);
        return {
          path: filePath,
          content: clipped.content,
          ...(clipped.truncated
            ? {
                truncated: true,
                original_length: clipped.originalLength,
              }
            : {}),
        };
      },
    },
    {
      name: 'write_file',
      description: 'Write content to a file in the workspace (creates or overwrites)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path within workspace' },
          content: { type: 'string', description: 'File content to write' },
        },
        required: ['path', 'content'],
      },
      source: 'builtin',
      metadata: { risk_level: 'medium', mutating: true, supports_parallel: false },
      handler: async (params) => {
        const filePath = extractString(params['path']);
        const content = params['content'];
        if (!filePath || typeof content !== 'string') {
          throw new ToolError('path and content are required', 'write_file');
        }
        const resolved = resolveWithinWorkDir(ctx.workDir, filePath, 'write_file');
        await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
        await fs.promises.writeFile(resolved, content, 'utf-8');
        return { path: filePath, bytes_written: Buffer.byteLength(content, 'utf-8') };
      },
    },
    {
      name: 'list_files',
      description: 'List files and directories at a path in the workspace',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative directory path (default: ".")' },
        },
      },
      source: 'builtin',
      metadata: { risk_level: 'low', mutating: false, supports_parallel: true },
      handler: async (params) => {
        const dirPath = extractString(params['path']) ?? '.';
        const resolved = resolveWithinWorkDir(ctx.workDir, dirPath, 'list_files');
        const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
        return entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        }));
      },
    },
    {
      name: 'glob_files',
      description: 'Find files matching a glob pattern in the workspace (supports ** and * wildcards)',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g. "src/**/*.ts", "*.json")' },
          cwd: { type: 'string', description: 'Relative base directory (default: workspace root)' },
        },
        required: ['pattern'],
      },
      source: 'builtin',
      metadata: { risk_level: 'low', mutating: false, supports_parallel: true },
      handler: async (params) => {
        const pattern = extractString(params['pattern']);
        if (!pattern) throw new ToolError('pattern is required', 'glob_files');
        const cwd = extractString(params['cwd']) ?? '.';
        const resolved = resolveWithinWorkDir(ctx.workDir, cwd, 'glob_files');

        // Build regex from glob pattern
        const regexStr = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex special chars
          .replace(/\*\*/g, '\0')                   // temp placeholder for **
          .replace(/\*/g, '[^/]*')                  // * matches within a segment
          .replace(/\0/g, '.*')                     // ** matches across segments
          .replace(/\?/g, '[^/]');                   // ? matches single char
        const regex = new RegExp(`^${regexStr}$`);

        const entries = (await fs.promises.readdir(resolved, { recursive: true })) as string[];
        const matches = entries
          .filter((entry) => regex.test(entry))
          .map((entry) => cwd === '.' ? entry : path.join(cwd, entry));

        return { pattern, matches: matches.slice(0, 500), total: matches.length };
      },
    },
    {
      name: 'grep_files',
      description: 'Search file contents for a regex pattern in the workspace',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          path: { type: 'string', description: 'Relative directory or file to search (default: ".")' },
          include: { type: 'string', description: 'File glob filter (e.g. "*.ts")' },
          max_results: { type: 'number', description: 'Max matches to return (default: 50)' },
        },
        required: ['pattern'],
      },
      source: 'builtin',
      metadata: { risk_level: 'low', mutating: false, supports_parallel: true },
      handler: async (params) => {
        const pattern = extractString(params['pattern']);
        if (!pattern) throw new ToolError('pattern is required', 'grep_files');
        const searchPath = extractString(params['path']) ?? '.';
        const include = extractString(params['include']);
        const maxResults = typeof params['max_results'] === 'number' ? params['max_results'] : 50;
        const resolved = resolveWithinWorkDir(ctx.workDir, searchPath, 'grep_files');
        const args = ['-rn', '--color=never', '-E', pattern];
        if (include) args.push('--include', include);
        args.push(resolved);
        return new Promise((resolve, reject) => {
          execFile('grep', args,
            { timeout: 15000, maxBuffer: 1024 * 1024 },
            (err, stdout) => {
              // grep exits with code 1 when no matches found — not an error
              const exitCode = (err as NodeJS.ErrnoException & { status?: number })?.status;
              if (err && exitCode !== 1 && !stdout) {
                reject(new ToolError(`grep failed: ${err.message}`, 'grep_files'));
                return;
              }
              const lines = stdout.trim().split('\n').filter(Boolean);
              const matches = lines.slice(0, maxResults).map((line) => {
                return line.startsWith(ctx.workDir) ? line.slice(ctx.workDir.length + 1) : line;
              });
              resolve({ pattern, matches, total: lines.length, truncated: lines.length > maxResults });
            },
          );
        });
      },
    },
    {
      name: 'delete_file',
      description: 'Delete a file from the workspace',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path within workspace' },
        },
        required: ['path'],
      },
      source: 'builtin',
      metadata: { risk_level: 'medium', mutating: true, supports_parallel: false },
      handler: async (params) => {
        const filePath = extractString(params['path']);
        if (!filePath) throw new ToolError('path is required', 'delete_file');
        const resolved = resolveWithinWorkDir(ctx.workDir, filePath, 'delete_file');
        const stat = await fs.promises.stat(resolved).catch(() => null);
        if (!stat) throw new ToolError(`File not found: ${filePath}`, 'delete_file');
        if (stat.isDirectory()) throw new ToolError('Cannot delete a directory with delete_file', 'delete_file');
        await fs.promises.unlink(resolved);
        return { path: filePath, deleted: true };
      },
    },
    {
      name: 'move_file',
      description: 'Move or rename a file within the workspace',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Current relative file path' },
          destination: { type: 'string', description: 'New relative file path' },
        },
        required: ['source', 'destination'],
      },
      source: 'builtin',
      metadata: { risk_level: 'medium', mutating: true, supports_parallel: false },
      handler: async (params) => {
        const src = extractString(params['source']);
        const dst = extractString(params['destination']);
        if (!src || !dst) throw new ToolError('source and destination are required', 'move_file');
        const resolvedSrc = resolveWithinWorkDir(ctx.workDir, src, 'move_file');
        const resolvedDst = resolveWithinWorkDir(ctx.workDir, dst, 'move_file');
        const stat = await fs.promises.stat(resolvedSrc).catch(() => null);
        if (!stat) throw new ToolError(`Source not found: ${src}`, 'move_file');
        await fs.promises.mkdir(path.dirname(resolvedDst), { recursive: true });
        await fs.promises.rename(resolvedSrc, resolvedDst);
        return { source: src, destination: dst, moved: true };
      },
    },
    {
      name: 'search_replace',
      description: 'Search and replace text in a file. Safer than apply_patch for targeted edits.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path' },
          search: { type: 'string', description: 'Exact text to find' },
          replace: { type: 'string', description: 'Replacement text' },
          all: { type: 'boolean', description: 'Replace all occurrences (default: false)' },
        },
        required: ['path', 'search', 'replace'],
      },
      source: 'builtin',
      metadata: { risk_level: 'medium', mutating: true, supports_parallel: false },
      handler: async (params) => {
        const filePath = extractString(params['path']);
        const search = params['search'];
        const replace = params['replace'];
        if (!filePath || typeof search !== 'string' || typeof replace !== 'string') {
          throw new ToolError('path, search, and replace are required', 'search_replace');
        }
        const resolved = resolveWithinWorkDir(ctx.workDir, filePath, 'search_replace');
        const content = await fs.promises.readFile(resolved, 'utf-8');
        if (!content.includes(search)) {
          throw new ToolError('Search string not found in file', 'search_replace');
        }
        const replaceAll = params['all'] === true;
        const updated = replaceAll
          ? content.split(search).join(replace)
          : content.replace(search, replace);
        const count = replaceAll
          ? (content.split(search).length - 1)
          : 1;
        await fs.promises.writeFile(resolved, updated, 'utf-8');
        return { path: filePath, replacements: count };
      },
    },
  ];
}
