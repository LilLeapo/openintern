#!/usr/bin/env node
/**
 * Agent CLI - Command line interface for Agent System
 *
 * Commands:
 * - agent init     Initialize configuration file
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
import { initCommand } from './commands/init.js';
import { tailCommand } from './commands/tail.js';
import { exportCommand } from './commands/export.js';
import { skillsListCommand } from './commands/skills.js';
import { doctorCommand } from './commands/doctor.js';

const program = new Command();

program
  .name('agent')
  .description('CLI for Agent System')
  .version('1.0.0');

// agent init
program
  .command('init')
  .description('Generate agent.config.json configuration file')
  .option('--force', 'Overwrite existing config file', false)
  .action((options: { force: boolean }) => {
    void initCommand(options);
  });

// agent dev
program
  .command('dev')
  .description('Start development server with Backend + MCP Server')
  .option('-p, --port <number>', 'Backend port', '3000')
  .option('--provider <provider>', 'LLM provider (openai|anthropic|mock)')
  .option('--model <model>', 'LLM model name')
  .option('--mcp-stdio', 'Use stdio mode for MCP (default)', true)
  .option('--no-mcp-stdio', 'Disable MCP Server')
  .option('--web', 'Show Web UI info', true)
  .option('--no-web', 'Hide Web UI info')
  .action((options: { port: string; provider?: string; model?: string; mcpStdio: boolean; web: boolean }) => {
    const devOpts: Parameters<typeof devCommand>[0] = {
      port: parseInt(options.port, 10),
      mcpStdio: options.mcpStdio,
      web: options.web,
    };
    if (options.provider) devOpts.provider = options.provider;
    if (options.model) devOpts.model = options.model;
    void devCommand(devOpts);
  });

// agent run
program
  .command('run')
  .description('Create and execute a new run')
  .argument('<text>', 'Task description')
  .option('-s, --session <key>', 'Session key', 'default')
  .option('-w, --wait', 'Wait for completion', false)
  .option('--stream', 'Stream events in real-time', false)
  .option('--provider <provider>', 'LLM provider (openai|anthropic|mock)')
  .option('--model <model>', 'LLM model name')
  .action(
    (
      text: string,
      options: { session: string; wait: boolean; stream: boolean; provider?: string; model?: string }
    ) => {
      const runOpts: Parameters<typeof runCommand>[1] = {
        session: options.session,
        wait: options.wait,
        stream: options.stream,
      };
      if (options.provider) runOpts.provider = options.provider;
      if (options.model) runOpts.model = options.model;
      void runCommand(text, runOpts);
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
