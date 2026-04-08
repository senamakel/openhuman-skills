// Tool: notion-append-blocks
import { notionApi } from '../api/index';
import { formatApiError, formatBlockSummary } from '../helpers';

export const appendBlocksTool: ToolDefinition = {
  name: 'append-blocks',
  description: 'Append child blocks to a page or block. Supports various block types.',
  input_schema: {
    type: 'object',
    properties: {
      block_id: { type: 'string', description: 'The parent page or block ID' },
      blocks: {
        type: 'string',
        description:
          'JSON string of blocks array. Example: [{"type":"paragraph","paragraph":{"rich_text":[{"text":{"content":"Hello"}}]}}]',
      },
    },
    required: ['block_id', 'blocks'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      const blockId = (args.block_id as string) || '';
      const blocksJson = (args.blocks as string) || '';

      if (!blockId) {
        return JSON.stringify({ error: 'block_id is required' });
      }
      if (!blocksJson) {
        return JSON.stringify({ error: 'blocks is required' });
      }

      let children: unknown[];
      try {
        children = JSON.parse(blocksJson);
      } catch {
        return JSON.stringify({ error: 'Invalid blocks JSON' });
      }

      if (!Array.isArray(children) || children.length === 0) {
        return JSON.stringify({ error: 'blocks must be a non-empty array' });
      }

      const result = notionApi.appendBlockChildren(blockId, children);

      return JSON.stringify({
        success: true,
        blocks_added: result.results.length,
        blocks: result.results.map((b: Record<string, unknown>) => formatBlockSummary(b)),
      });
    } catch (e) {
      return JSON.stringify({ error: formatApiError(e) });
    }
  },
};
