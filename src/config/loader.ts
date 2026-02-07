/**
 * Config Loader - Load agent configuration from file and environment
 *
 * Priority (low to high):
 * 1. Config file (agent.config.ts/js/json)
 * 2. Environment variables
 * 3. CLI arguments (handled by callers)
 * 4. API request params (handled by callers)
 */

import { readFile } from 'fs/promises';
import { resolve, extname } from 'path';
import { existsSync } from 'fs';
import type { AgentConfig, LLMConfig } from '../types/agent.js';
import { logger } from '../utils/logger.js';

const CONFIG_FILE_NAMES = [
  'agent.config.json',
  'agent.config.js',
  'agent.config.mjs',
];

let cachedConfig: AgentConfig | null = null;

/**
 * Find the config file path in the given directory
 */
function findConfigFile(dir: string): string | null {
  for (const name of CONFIG_FILE_NAMES) {
    const filePath = resolve(dir, name);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

/**
 * Load config from a JSON file
 */
async function loadJsonConfig(filePath: string): Promise<AgentConfig> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as AgentConfig;
}

/**
 * Load config from a JS/MJS file (ESM dynamic import)
 */
async function loadJsConfig(filePath: string): Promise<AgentConfig> {
  const absolutePath = resolve(filePath);
  const mod = (await import(absolutePath)) as { default?: AgentConfig };
  return mod.default ?? (mod as unknown as AgentConfig);
}

/**
 * Load config from file
 */
async function loadConfigFile(dir: string): Promise<AgentConfig> {
  const filePath = findConfigFile(dir);
  if (!filePath) {
    return {};
  }

  logger.debug('Loading config file', { path: filePath });

  const ext = extname(filePath);
  if (ext === '.json') {
    return loadJsonConfig(filePath);
  }
  return loadJsConfig(filePath);
}

/**
 * Read LLM-related environment variables and merge into config
 */
function applyEnvOverrides(config: AgentConfig): AgentConfig {
  const result = structuredClone(config);

  // LLM env overrides
  const envProvider = process.env['LLM_PROVIDER'];
  const envModel = process.env['LLM_MODEL'];
  const envBaseUrl = process.env['LLM_BASE_URL'];
  const envApiKey = process.env['LLM_API_KEY'];
  const envTemp = process.env['LLM_TEMPERATURE'];
  const envMaxTokens = process.env['LLM_MAX_TOKENS'];

  if (envProvider || envModel || envBaseUrl || envApiKey || envTemp || envMaxTokens) {
    if (!result.llm) result.llm = {};
    if (envProvider) result.llm.provider = envProvider as 'openai' | 'anthropic' | 'mock';
    if (envModel) result.llm.model = envModel;
    if (envBaseUrl) result.llm.baseUrl = envBaseUrl;
    if (envApiKey) result.llm.apiKey = envApiKey;
    if (envTemp) result.llm.temperature = parseFloat(envTemp);
    if (envMaxTokens) result.llm.maxTokens = parseInt(envMaxTokens, 10);
  }

  // Legacy API key env vars (lower priority than LLM_API_KEY)
  if (!result.llm?.apiKey) {
    const openaiKey = process.env['OPENAI_API_KEY'];
    const anthropicKey = process.env['ANTHROPIC_API_KEY'];
    if (openaiKey || anthropicKey) {
      if (!result.llm) result.llm = {};
      if (openaiKey && (!result.llm.provider || result.llm.provider === 'openai')) {
        result.llm.apiKey = openaiKey;
        if (!result.llm.provider) result.llm.provider = 'openai';
        if (!result.llm.model) result.llm.model = 'gpt-4o';
      } else if (anthropicKey && (!result.llm.provider || result.llm.provider === 'anthropic')) {
        result.llm.apiKey = anthropicKey;
        if (!result.llm.provider) result.llm.provider = 'anthropic';
        if (!result.llm.model) result.llm.model = 'claude-sonnet-4-20250514';
      }
    }
  }

  // Server env overrides
  const envPort = process.env['PORT'];
  const envDataDir = process.env['DATA_DIR'];
  if (envPort || envDataDir) {
    if (!result.server) result.server = {};
    if (envPort) result.server.port = parseInt(envPort, 10);
    if (envDataDir) result.server.baseDir = envDataDir;
  }

  // Embedding env overrides
  const envEmbeddingProvider = process.env['EMBEDDING_PROVIDER'];
  const envEmbeddingApiUrl = process.env['EMBEDDING_API_URL'];
  const envEmbeddingApiModel = process.env['EMBEDDING_API_MODEL'];
  if (envEmbeddingProvider || envEmbeddingApiUrl || envEmbeddingApiModel) {
    if (!result.embedding) result.embedding = {};
    if (envEmbeddingProvider) {
      result.embedding.provider = envEmbeddingProvider as 'hash' | 'api';
    }
    if (envEmbeddingApiUrl) result.embedding.apiUrl = envEmbeddingApiUrl;
    if (envEmbeddingApiModel) result.embedding.apiModel = envEmbeddingApiModel;
  }

  return result;
}

/**
 * Load and cache the agent configuration
 */
export async function loadConfig(dir: string = process.cwd()): Promise<AgentConfig> {
  if (cachedConfig) return cachedConfig;

  let fileConfig: AgentConfig;
  try {
    fileConfig = await loadConfigFile(dir);
  } catch (err) {
    logger.warn('Failed to load config file, using defaults', {
      error: err instanceof Error ? err.message : String(err),
    });
    fileConfig = {};
  }

  cachedConfig = applyEnvOverrides(fileConfig);
  return cachedConfig;
}

/**
 * Clear cached config (useful for testing)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * Convert AgentConfig.llm to LLMConfig
 */
export function toLLMConfig(config: AgentConfig): LLMConfig | undefined {
  const llm = config.llm;
  if (!llm || !llm.provider) return undefined;

  const result: LLMConfig = {
    provider: llm.provider,
    model: llm.model ?? (llm.provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-20250514'),
  };
  if (llm.apiKey) result.apiKey = llm.apiKey;
  if (llm.baseUrl) result.baseUrl = llm.baseUrl;
  if (llm.temperature !== undefined) result.temperature = llm.temperature;
  if (llm.maxTokens !== undefined) result.maxTokens = llm.maxTokens;
  return result;
}
