import type { ToolResult } from '../../types/agent.js';

export function formatToolResultMessageContent(result: ToolResult): string {
  const prefix = result.humanInterventionNote
    ? `${result.humanInterventionNote}\n\n`
    : '';

  if (result.success) {
    return `${prefix}${JSON.stringify(result.result)}`;
  }
  return `${prefix}Error: ${result.error ?? 'Unknown tool error'}`;
}
