/**
 * CLI Command: agent dev
 *
 * Start development server with Backend + MCP Server
 */

import { createServer, type ServerInstance } from '../../backend/server.js';
import { loadConfig, toLLMConfig } from '../../config/loader.js';
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

  // Setup graceful shutdown
  const shutdown = async (): Promise<void> => {
    output.print('');
    output.info('Shutting down...');

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
    if (agentConfig.server?.databaseUrl) {
      serverConfig.databaseUrl = agentConfig.server.databaseUrl;
    }
    if (agentConfig.embedding) {
      serverConfig.embeddingConfig = {
        provider: agentConfig.embedding.provider ?? 'hash',
        dimension: agentConfig.embedding.dimension ?? 256,
        alpha: agentConfig.embedding.alpha ?? 0.6,
        ...(agentConfig.embedding.apiUrl ? { apiUrl: agentConfig.embedding.apiUrl } : {}),
        ...(agentConfig.embedding.apiModel ? { apiModel: agentConfig.embedding.apiModel } : {}),
      };
    }
    serverConfig.mcp = {
      enabled: options.mcpStdio,
      pythonPath: 'python3',
      serverModule: 'mcp_server.server',
      cwd: 'python',
      timeoutMs: 30000,
    };

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

    if (options.mcpStdio) {
      output.info('MCP tools: enabled (started on demand by runtime)');
    } else {
      output.info('MCP tools: disabled');
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
