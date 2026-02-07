/**
 * CLI Command: agent dev
 *
 * Start development server with Backend + MCP Server
 */

import { spawn, ChildProcess } from 'child_process';
import { createServer, type ServerInstance } from '../../backend/server.js';
import { loadConfig, toLLMConfig } from '../../config/loader.js';
import { logger } from '../../utils/logger.js';
import * as output from '../utils/output.js';

export interface DevOptions {
  port: number;
  mcpStdio: boolean;
  web: boolean;
  provider?: string;
  model?: string;
}

/**
 * Execute the dev command
 */
export async function devCommand(options: DevOptions): Promise<void> {
  output.header('Starting Agent Development Server');

  let server: ServerInstance | null = null;
  let mcpProcess: ChildProcess | null = null;

  // Setup graceful shutdown
  const shutdown = async (): Promise<void> => {
    output.print('');
    output.info('Shutting down...');

    if (mcpProcess) {
      mcpProcess.kill();
      output.success('MCP Server stopped');
    }

    if (server) {
      await server.stop();
      output.success('Backend Server stopped');
    }

    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  try {
    // Load config file + env vars
    const agentConfig = await loadConfig();

    // Build server config: config file < CLI options
    const serverConfig: Parameters<typeof createServer>[0] = {
      port: agentConfig.server?.port ?? options.port,
      baseDir: agentConfig.server?.baseDir ?? 'data',
    };
    if (agentConfig.server?.corsOrigins) {
      serverConfig.corsOrigins = agentConfig.server.corsOrigins;
    }

    // LLM config: config file as base, CLI options override
    if (options.provider) {
      const provider = options.provider as 'openai' | 'anthropic' | 'mock';
      serverConfig.defaultModelConfig = {
        provider,
        model: options.model ?? (provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-20250514'),
      };
    } else {
      const llmConfig = toLLMConfig(agentConfig);
      if (llmConfig) {
        serverConfig.defaultModelConfig = llmConfig;
      }
    }

    // Agent config
    if (agentConfig.agent?.maxSteps) {
      serverConfig.maxSteps = agentConfig.agent.maxSteps;
    }
    if (agentConfig.agent?.workDir) {
      serverConfig.workDir = agentConfig.agent.workDir;
    }

    // Start Backend Server
    output.progress('Starting Backend Server');
    server = createServer(serverConfig);
    await server.start();
    output.progressDone();
    output.success(`Backend Server started at http://localhost:${serverConfig.port ?? options.port}`);

    // Start MCP Server if stdio mode
    if (options.mcpStdio) {
      output.progress('Starting Python MCP Server');
      try {
        mcpProcess = spawn('python3', ['-m', 'mcp_server.server'], {
          cwd: 'python',
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        mcpProcess.on('error', (err) => {
          logger.warn('MCP Server error', { error: err.message });
        });

        mcpProcess.on('close', (code) => {
          if (code !== 0 && code !== null) {
            logger.warn('MCP Server exited', { code });
          }
        });

        output.progressDone();
        output.success('Python MCP Server connected (stdio)');
      } catch (err) {
        output.progressFailed();
        output.warn('Python MCP Server not available');
        logger.debug('MCP Server start failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Web UI info
    if (options.web) {
      output.info('Web UI: Run "pnpm dev:web" in another terminal');
    }

    output.print('');
    output.print('Press Ctrl+C to stop');
    output.print('');

    // Keep process running
    await new Promise(() => {
      // Never resolves - wait for shutdown signal
    });
  } catch (err) {
    output.error(
      `Failed to start server: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }
}
