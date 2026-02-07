#!/usr/bin/env node
/**
 * Agent CLI - Command line interface for Agent System
 *
 * Commands:
 * - agent dev      Start development server
 * - agent run      Create and execute a run
 * - agent tail     Stream events from a run
 * - agent export   Export events to file
 * - agent skills   List available tools
 * - agent doctor   Run diagnostics
 */

import { Command } from 'commander';
import { devCommand } from './commands/dev.js';
import { runCommand } from './commands/run.js';
import { tailCommand } from './commands/tail.js';
import { exportCommand } from './commands/export.js';
import { skillsListCommand } from './commands/skills.js';
import { doctorCommand } from './commands/doctor.js';

const program = new Command();

program
  .name('agent')
  .description('CLI for Agent System')
  .version('1.0.0');

// agent dev
program
  .command('dev')
  .description('Start development server with Backend + MCP Server')
  .option('-p, --port <number>', 'Backend port', '3000')
  .option('--mcp-stdio', 'Use stdio mode for MCP (default)', true)
  .option('--no-mcp-stdio', 'Disable MCP Server')
  .option('--web', 'Show Web UI info', true)
  .option('--no-web', 'Hide Web UI info')
  .action((options: { port: string; mcpStdio: boolean; web: boolean }) => {
    void devCommand({
      port: parseInt(options.port, 10),
      mcpStdio: options.mcpStdio,
      web: options.web,
    });
  });

// agent run
program
  .command('run')
  .description('Create and execute a new run')
  .argument('<text>', 'Task description')
  .option('-s, --session <key>', 'Session key', 'default')
  .option('-w, --wait', 'Wait for completion', false)
  .option('--stream', 'Stream events in real-time', false)
  .action(
    (
      text: string,
      options: { session: string; wait: boolean; stream: boolean }
    ) => {
      void runCommand(text, options);
    }
  );

// agent tail
program
  .command('tail')
  .description('Stream events from a run in real-time')
  .argument('<run_id>', 'Run ID')
  .option('-f, --format <format>', 'Output format (json|pretty)', 'pretty')
  .action((runId: string, options: { format: string }) => {
    const format = options.format === 'json' ? 'json' : 'pretty';
    void tailCommand(runId, { format });
  });

// agent export
program
  .command('export')
  .description('Export events from a run to file')
  .argument('<run_id>', 'Run ID')
  .option('-o, --out <file>', 'Output file (default: stdout)')
  .option('-f, --format <format>', 'Output format (jsonl|json)', 'jsonl')
  .option('--filter <type>', 'Filter by event type')
  .option('-s, --session <key>', 'Session key', 'default')
  .action(
    (
      runId: string,
      options: {
        out?: string;
        format: string;
        filter?: string;
        session: string;
      }
    ) => {
      const format = options.format === 'json' ? 'json' : 'jsonl';
      void exportCommand(runId, {
        out: options.out,
        format,
        filter: options.filter,
        session: options.session,
      });
    }
  );

// agent skills (subcommand group)
const skillsCmd = program
  .command('skills')
  .description('Manage MCP tools');

skillsCmd
  .command('list')
  .description('List available tools')
  .option('-f, --format <format>', 'Output format (table|json)', 'table')
  .action((options: { format: string }) => {
    const format = options.format === 'json' ? 'json' : 'table';
    void skillsListCommand({ format });
  });

// agent doctor
program
  .command('doctor')
  .description('Run diagnostics and check environment')
  .option('--fix', 'Auto-fix issues where possible', false)
  .action((options: { fix: boolean }) => {
    void doctorCommand(options);
  });

program.parse();
