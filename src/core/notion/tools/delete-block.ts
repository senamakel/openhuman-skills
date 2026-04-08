// Tool: notion-delete-block
// Request: notion.blocks.delete({ block_id })
// Response: { object, id }
import { notionApi } from '../api/index';
import { formatApiError } from '../helpers';

export const deleteBlockTool: ToolDefinition = {
  name: 'delete-block',
  description: 'Delete a block. Permanently removes the block from Notion.',
  input_schema: {
    type: 'object',
    properties: { block_id: { type: 'string', description: 'The block ID to delete' } },
    required: ['block_id'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      const blockId = (args.block_id as string) || '';
      if (!blockId) {
        return JSON.stringify({ error: 'block_id is required' });
      }

      const result = notionApi.deleteBlock(blockId);
      const rec = result as Record<string, unknown>;

      return JSON.stringify({ object: rec.object || 'block', id: rec.id });
    } catch (e) {
      return JSON.stringify({ error: formatApiError(e) });
    }
  },
};
