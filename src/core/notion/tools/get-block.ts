// Tool: notion-get-block
import { notionApi } from '../api/index';
import { formatApiError, formatBlockSummary } from '../helpers';

export const getBlockTool: ToolDefinition = {
  name: 'get-block',
  description: "Get a block by its ID. Returns the block's type and content.",
  input_schema: {
    type: 'object',
    properties: { block_id: { type: 'string', description: 'The block ID' } },
    required: ['block_id'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      const blockId = (args.block_id as string) || '';
      if (!blockId) {
        return JSON.stringify({ error: 'block_id is required' });
      }

      const block = notionApi.getBlock(blockId);

      return JSON.stringify({
        ...formatBlockSummary(block as Record<string, unknown>),
        raw: block,
      });
    } catch (e) {
      return JSON.stringify({ error: formatApiError(e) });
    }
  },
};
