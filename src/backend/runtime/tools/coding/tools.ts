import fs from 'node:fs';
import { execFile } from 'node:child_process';
import type { RuntimeTool, ToolContext } from '../_helpers.js';
import { extractString, resolveWithinWorkDir } from '../_helpers.js';
import { ToolError } from '../../../../utils/errors.js';

export function register(ctx: ToolContext): RuntimeTool[] {
  return [
    {
      name: 'exec_command',
      description: 'Execute a shell command in the workspace directory',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          timeout_ms: { type: 'number', description: 'Timeout in ms (default: 30000)' },
          cwd: { type: 'string', description: 'Working directory relative to workspace' },
        },
        required: ['command'],
      },
      source: 'builtin',
      metadata: { risk_level: 'high', mutating: true, supports_parallel: false },
      handler: async (params) => {
        const command = extractString(params['command']);
        if (!command) throw new ToolError('command is required', 'exec_command');
        const timeoutMs = typeof params['timeout_ms'] === 'number' ? params['timeout_ms'] : 30000;
        const cwdRel = extractString(params['cwd']);
        const cwd = cwdRel ? resolveWithinWorkDir(ctx.workDir, cwdRel, 'exec_command') : ctx.workDir;
        return new Promise((resolve) => {
          execFile('sh', ['-c', command], {
            cwd,
            timeout: Math.min(timeoutMs, 120000),
            maxBuffer: 1024 * 1024,
          }, (err, stdout, stderr) => {
            let exitCode = 0;
            if (err) {
              // child_process error: status holds the numeric exit code,
              // code may be a string error code like 'ERR_CHILD_PROCESS_STDIO_FINAL_CLOSE'
              const status = (err as NodeJS.ErrnoException & { status?: number }).status;
              exitCode = typeof status === 'number' ? status : 1;
            }
            resolve({
              exit_code: exitCode,
              stdout: stdout.slice(0, 50000),
              stderr: stderr.slice(0, 10000),
            });
          });
        });
      },
    },
    {
      name: 'apply_patch',
      description: 'Apply a unified diff patch to a file in the workspace',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace' },
          patch: { type: 'string', description: 'Unified diff content to apply' },
        },
        required: ['path', 'patch'],
      },
      source: 'builtin',
      metadata: { risk_level: 'medium', mutating: true, supports_parallel: false },
      handler: async (params) => {
        const filePath = extractString(params['path']);
        const patch = extractString(params['patch']);
        if (!filePath || !patch) throw new ToolError('path and patch are required', 'apply_patch');
        const resolved = resolveWithinWorkDir(ctx.workDir, filePath, 'apply_patch');
        const original = await fs.promises.readFile(resolved, 'utf-8');
        const lines = original.split('\n');
        const patchLines = patch.split('\n');
        // Track cumulative shift from previous hunks (insertions - deletions)
        let cumulativeShift = 0;
        let offset = 0;
        for (const pl of patchLines) {
          if (pl.startsWith('@@')) {
            const match = pl.match(/@@ -(\d+)/);
            if (match?.[1] !== undefined) {
              // Apply cumulative shift from prior hunks to the new hunk start
              offset = parseInt(match[1], 10) - 1 + cumulativeShift;
            }
          } else if (pl.startsWith('---') || pl.startsWith('+++')) {
            // Skip file header lines
          } else if (pl.startsWith('-')) {
            if (offset < lines.length) {
              lines.splice(offset, 1);
              cumulativeShift--;
            }
            // Don't advance offset — next line is now at same index
          } else if (pl.startsWith('+')) {
            lines.splice(offset, 0, pl.slice(1));
            offset++;
            cumulativeShift++;
          } else if (!pl.startsWith('\\')) {
            // Context line — just advance
            offset++;
          }
        }
        await fs.promises.writeFile(resolved, lines.join('\n'), 'utf-8');
        return { path: filePath, applied: true };
      },
    },
  ];
}
