// Tool: notion-list-comments
import { notionApi } from '../api/index';
import { formatApiError, formatRichText } from '../helpers';

export const listCommentsTool: ToolDefinition = {
  name: 'list-comments',
  description: 'List comments on a block or page.',
  input_schema: {
    type: 'object',
    properties: {
      block_id: { type: 'string', description: 'Block or page ID to get comments for' },
      page_size: { type: 'number', description: 'Number of results (default 20, max 100)' },
    },
    required: ['block_id'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      const blockId = (args.block_id as string) || '';
      const pageSize = Math.min((args.page_size as number) || 20, 100);

      if (!blockId) {
        return JSON.stringify({ error: 'block_id is required' });
      }

      const result = notionApi.listComments(blockId, pageSize);

      const comments = result.results.map((comment: Record<string, unknown>) => {
        const commentRec = comment;
        return {
          id: commentRec.id,
          discussion_id: commentRec.discussion_id,
          created_time: commentRec.created_time,
          created_by: commentRec.created_by,
          text: formatRichText(commentRec.rich_text as unknown[]),
        };
      });

      return JSON.stringify({ count: comments.length, has_more: result.has_more, comments });
    } catch (e) {
      return JSON.stringify({ error: formatApiError(e) });
    }
  },
};
