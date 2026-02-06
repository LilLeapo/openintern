/**
 * MCP Client - Communicates with Python MCP Server via stdio
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger.js';

/**
 * MCP Request interface (JSON-RPC 2.0)
 */
export interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * MCP Response interface (JSON-RPC 2.0)
 */
export interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP Client configuration
 */
export interface MCPClientConfig {
  pythonPath?: string;
  serverModule?: string;
  cwd?: string;
  timeout?: number;
}

const DEFAULT_CONFIG: Required<MCPClientConfig> = {
  pythonPath: 'python',
  serverModule: 'mcp_server.server',
  cwd: 'python',
  timeout: 30000,
};

/**
 * MCP Client for communicating with Python MCP Server
 */
export class MCPClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private config: Required<MCPClientConfig>;
  private buffer = '';
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(config: MCPClientConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the MCP server process
   */
  async start(): Promise<void> {
    if (this.process) {
      throw new Error('MCP Client already started');
    }

    logger.info('Starting MCP server', {
      pythonPath: this.config.pythonPath,
      serverModule: this.config.serverModule,
    });

    this.process = spawn(
      this.config.pythonPath,
      ['-m', this.config.serverModule],
      {
        cwd: this.config.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    this.setupProcessHandlers();
    await this.initialize();
  }

  /**
   * Setup process event handlers
   */
  private setupProcessHandlers(): void {
    if (!this.process) return;

    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleData(data.toString());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      logger.debug('MCP stderr', { data: data.toString() });
    });

    this.process.on('close', (code) => {
      logger.info('MCP server closed', { code });
      this.emit('close', code);
    });

    this.process.on('error', (err) => {
      logger.error('MCP server error', { error: err.message });
      this.emit('error', err);
    });
  }

  /**
   * Handle incoming data from stdout
   */
  private handleData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line) as MCPResponse;
        this.handleResponse(response);
      } catch {
        logger.warn('Failed to parse MCP response', { line });
      }
    }
  }

  /**
   * Handle response from server
   */
  private handleResponse(response: MCPResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * Send a request to the server
   */
  async request(
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    if (!this.process) {
      throw new Error('MCP Client not started');
    }

    const id = ++this.requestId;
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined && { params }),
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.config.timeout);

      this.pendingRequests.set(id, { resolve, reject, timer });

      const data = JSON.stringify(request) + '\n';
      this.process?.stdin?.write(data);
    });
  }

  /**
   * Initialize the MCP connection
   */
  private async initialize(): Promise<void> {
    await this.request('initialize', {});
    logger.info('MCP connection initialized');
  }

  /**
   * List available tools
   */
  async listTools(): Promise<MCPTool[]> {
    const result = (await this.request('tools/list')) as {
      tools: MCPTool[];
    };
    return result.tools;
  }

  /**
   * Call a tool
   */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const result = await this.request('tools/call', {
      name,
      arguments: args,
    });
    return result;
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    if (!this.process) return;

    try {
      await this.request('shutdown');
    } catch {
      // Ignore shutdown errors
    }

    this.process.kill();
    this.process = null;
    logger.info('MCP server stopped');
  }

  /**
   * Check if the client is running
   */
  isRunning(): boolean {
    return this.process !== null;
  }
}
