/**
 * ToolRouter tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { ToolRouter } from './tool-router.js';

describe('ToolRouter', () => {
  let router: ToolRouter;
  const testDir = '/tmp/test-tool-router-' + Date.now();

  beforeEach(async () => {
    await fs.promises.mkdir(testDir, { recursive: true });
    router = new ToolRouter({ memoryBaseDir: `${testDir}/memory` });
  });

  afterEach(async () => {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

  describe('Tool registration', () => {
    it('should have built-in memory tools', () => {
      const tools = router.listTools();
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain('memory.write');
      expect(toolNames).toContain('memory.search');
      expect(toolNames).toContain('memory.get');
    });

    it('should register custom tool', () => {
      router.registerTool({
        name: 'custom.tool',
        description: 'A custom tool',
        parameters: { type: 'object' },
        execute: () => Promise.resolve({ result: 'ok' }),
      });

      expect(router.hasTool('custom.tool')).toBe(true);
      expect(router.getToolCount()).toBe(4); // 3 built-in + 1 custom
    });

    it('should unregister tool', () => {
      router.registerTool({
        name: 'temp.tool',
        description: 'Temporary',
        parameters: {},
        execute: () => Promise.resolve({}),
      });

      expect(router.hasTool('temp.tool')).toBe(true);
      router.unregisterTool('temp.tool');
      expect(router.hasTool('temp.tool')).toBe(false);
    });
  });

  describe('Tool execution', () => {
    it('should call memory.write tool', async () => {
      const result = await router.callTool('memory.write', {
        content: 'Test content',
        tags: ['test'],
      });

      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty('id');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should call memory.search tool', async () => {
      // First write something
      await router.callTool('memory.write', {
        content: 'Searchable content',
      });

      const result = await router.callTool('memory.search', {
        query: 'searchable',
        topK: 5,
      });

      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty('results');
    });

    it('should return error for non-existent tool', async () => {
      const result = await router.callTool('non.existent', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle tool execution errors', async () => {
      router.registerTool({
        name: 'error.tool',
        description: 'Always fails',
        parameters: {},
        execute: () => Promise.reject(new Error('Intentional error')),
      });

      const result = await router.callTool('error.tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Intentional error');
    });
  });
});