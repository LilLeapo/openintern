/**
 * File Tools - Built-in file operation tools for the Agent
 *
 * Tools:
 * - file.read: Read file content
 * - file.write: Write content to file
 * - file.list: List directory contents
 * - file.exists: Check if file/directory exists
 */

import fs from 'node:fs';
import path from 'node:path';
import { ToolError, SandboxError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { PathGuard } from './sandbox/path-guard.js';
import type { Tool } from './tool-router.js';

const MAX_READ_SIZE = 100 * 1024; // 100KB max read
const MAX_WRITE_SIZE = 1024 * 1024; // 1MB max write

/**
 * Create all file operation tools
 */
export function createFileTools(baseDir: string, customWorkDir?: string): Tool[] {
  const workDir = customWorkDir ? path.resolve(customWorkDir) : path.resolve(baseDir, 'workspace');
  const pathGuard = new PathGuard(workDir);

  return [
    createFileReadTool(workDir, pathGuard),
    createFileWriteTool(workDir, pathGuard),
    createFileListTool(workDir, pathGuard),
    createFileExistsTool(workDir, pathGuard),
  ];
}

/**
 * file.read - Read file content
 */
function createFileReadTool(workDir: string, pathGuard: PathGuard): Tool {
  return {
    name: 'file.read',
    description: 'Read the content of a file. Returns the text content of the specified file.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative file path to read',
        },
      },
      required: ['path'],
    },
    execute: async (params) => {
      const filePath = params['path'] as string;
      if (!filePath || typeof filePath !== 'string') {
        throw new ToolError('path is required and must be a string', 'file.read');
      }

      const resolved = await pathGuard.validate(filePath, workDir);

      // Ensure workspace exists
      await fs.promises.mkdir(workDir, { recursive: true });

      const stat = await fs.promises.stat(resolved);
      if (!stat.isFile()) {
        throw new ToolError(`"${filePath}" is not a file`, 'file.read');
      }
      if (stat.size > MAX_READ_SIZE) {
        throw new ToolError(
          `File too large (${stat.size} bytes, max ${MAX_READ_SIZE})`,
          'file.read'
        );
      }

      const content = await fs.promises.readFile(resolved, 'utf-8');
      logger.debug('File read', { path: filePath, size: content.length });
      return { path: filePath, content, size: stat.size };
    },
  };
}

/**
 * file.write - Write content to file
 */
function createFileWriteTool(workDir: string, pathGuard: PathGuard): Tool {
  return {
    name: 'file.write',
    description: 'Write content to a file. Creates parent directories if needed. Overwrites existing file.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative file path to write',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
    execute: async (params) => {
      const filePath = params['path'] as string;
      const content = params['content'] as string;

      if (!filePath || typeof filePath !== 'string') {
        throw new ToolError('path is required and must be a string', 'file.write');
      }
      if (typeof content !== 'string') {
        throw new ToolError('content must be a string', 'file.write');
      }

      // Write size limit
      const byteSize = Buffer.byteLength(content, 'utf-8');
      if (byteSize > MAX_WRITE_SIZE) {
        throw new SandboxError(
          `Write size ${byteSize} bytes exceeds limit of ${MAX_WRITE_SIZE} bytes`,
          'write_size_exceeded',
          { path: filePath, size: byteSize, maxWriteSize: MAX_WRITE_SIZE },
        );
      }

      const resolved = await pathGuard.validate(filePath, workDir);

      // Ensure parent directory exists
      await fs.promises.mkdir(path.dirname(resolved), { recursive: true });

      await fs.promises.writeFile(resolved, content, 'utf-8');
      logger.debug('File written', { path: filePath, size: content.length });
      return { path: filePath, size: content.length, success: true };
    },
  };
}

/**
 * file.list - List directory contents
 */
function createFileListTool(workDir: string, pathGuard: PathGuard): Tool {
  return {
    name: 'file.list',
    description: 'List files and directories in a given path. Returns names and types.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative directory path to list (default: ".")',
        },
      },
      required: [],
    },
    execute: async (params) => {
      const dirPath = (params['path'] as string) || '.';
      const resolved = await pathGuard.validate(dirPath, workDir);

      // Ensure workspace exists
      await fs.promises.mkdir(workDir, { recursive: true });

      const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
      const items = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
      }));

      logger.debug('Directory listed', { path: dirPath, count: items.length });
      return { path: dirPath, entries: items };
    },
  };
}

/**
 * file.exists - Check if file/directory exists
 */
function createFileExistsTool(workDir: string, pathGuard: PathGuard): Tool {
  return {
    name: 'file.exists',
    description: 'Check if a file or directory exists at the given path.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to check',
        },
      },
      required: ['path'],
    },
    execute: async (params) => {
      const filePath = params['path'] as string;
      if (!filePath || typeof filePath !== 'string') {
        throw new ToolError('path is required and must be a string', 'file.exists');
      }

      const resolved = await pathGuard.validate(filePath, workDir);

      try {
        const stat = await fs.promises.stat(resolved);
        return {
          path: filePath,
          exists: true,
          type: stat.isDirectory() ? 'directory' : 'file',
          size: stat.size,
        };
      } catch {
        return { path: filePath, exists: false };
      }
    },
  };
}
