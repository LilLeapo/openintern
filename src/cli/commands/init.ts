/**
 * CLI Command: agent init
 *
 * Generate a default agent.config.json configuration file
 */

import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';
import * as output from '../utils/output.js';

export interface InitOptions {
  force: boolean;
}

const DEFAULT_CONFIG = {
  llm: {
    provider: 'openai',
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
    temperature: 0.7,
    maxTokens: 2000,
  },
  server: {
    port: 3000,
    baseDir: 'data',
  },
  agent: {
    maxSteps: 10,
    timeout: 300000,
  },
};

const CONFIG_FILE = 'agent.config.json';

/**
 * Execute the init command
 */
export async function initCommand(options: InitOptions): Promise<void> {
  output.header('Initializing Agent Configuration');

  const filePath = resolve(process.cwd(), CONFIG_FILE);

  if (existsSync(filePath) && !options.force) {
    output.warn(`${CONFIG_FILE} already exists. Use --force to overwrite.`);
    return;
  }

  const content = JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n';
  await writeFile(filePath, content, 'utf-8');

  output.success(`Created ${CONFIG_FILE}`);
  output.print('');
  output.info('Edit the file to configure your agent:');
  output.keyValue('LLM Provider', 'llm.provider (openai | anthropic | mock)');
  output.keyValue('Model', 'llm.model');
  output.keyValue('Base URL', 'llm.baseUrl (custom API endpoint)');
  output.keyValue('API Key', 'llm.apiKey (or use env: OPENAI_API_KEY / ANTHROPIC_API_KEY)');
  output.print('');
}
