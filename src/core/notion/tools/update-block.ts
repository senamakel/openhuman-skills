// Tool: notion-update-block
import { notionApi } from '../api/index';
import { formatApiError, formatBlockSummary } from '../helpers';

export const updateBlockTool: ToolDefinition = {
  name: 'update-block',
  description: "Update a block's content. The structure depends on the block type.",
  input_schema: {
    type: 'object',
    properties: {
      block_id: { type: 'string', description: 'The block ID to update' },
      content: {
        type: 'string',
        description:
          'JSON string of the block type content. Example for paragraph: {"paragraph":{"rich_text":[{"text":{"content":"Updated text"}}]}}',
      },
      archived: {
        type: 'string',
        enum: ['true', 'false'],
        description: 'Set to true to archive the block',
      },
    },
    required: ['block_id'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      const blockId = (args.block_id as string) || '';
      const contentJson = args.content as string | undefined;
      const archived = args.archived as string | undefined;

      if (!blockId) {
        return JSON.stringify({ error: 'block_id is required' });
      }

      const body: Record<string, unknown> = {};

      if (contentJson) {
        try {
          const content = JSON.parse(contentJson);
          Object.assign(body, content);
        } catch {
          return JSON.stringify({ error: 'Invalid content JSON' });
        }
      }

      if (archived !== undefined) {
        body.archived = archived === 'true';
      }

      if (Object.keys(body).length === 0) {
        return JSON.stringify({ error: 'No updates specified' });
      }

      const block = notionApi.updateBlock(blockId, body);

      return JSON.stringify({
        success: true,
        block: formatBlockSummary(block as Record<string, unknown>),
      });
    } catch (e) {
      return JSON.stringify({ error: formatApiError(e) });
    }
  },
};
