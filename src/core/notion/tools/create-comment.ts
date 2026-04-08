// Tool: notion-create-comment
// API: https://developers.notion.com/reference/create-a-comment
// Request: parent: { type: "page_id", page_id } OR discussion_id; rich_text: [{ text: { content } }]
// Response: { object, id }
// Note: Integration must have "insert comment" capability (403 otherwise).
import { notionApi } from '../api/index';
import { buildRichText, formatApiError } from '../helpers';

export const createCommentTool: ToolDefinition = {
  name: 'create-comment',
  description:
    'Create a comment on a page or block, or reply to a discussion. ' +
    'Provide either page_id (new comment on page) or discussion_id (reply). ' +
    'Requires Notion integration to have insert comment capability.',
  input_schema: {
    type: 'object',
    properties: {
      page_id: { type: 'string', description: 'Page ID to create a comment on (new discussion)' },
      block_id: {
        type: 'string',
        description: 'Block ID to comment on (optional, use instead of page_id)',
      },
      discussion_id: {
        type: 'string',
        description: 'Discussion ID to reply to an existing thread (use instead of page_id)',
      },
      text: { type: 'string', description: 'Comment text content' },
    },
    required: ['text'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      const pageId = args.page_id as string | undefined;
      const blockId = args.block_id as string | undefined;
      const discussionId = args.discussion_id as string | undefined;
      const text = (args.text as string) || '';

      const hasParent = !!(pageId || blockId);
      if (!hasParent && !discussionId) {
        return JSON.stringify({ error: 'Provide one of: page_id, block_id, or discussion_id' });
      }
      if (hasParent && discussionId) {
        return JSON.stringify({
          error:
            'Provide only one: page_id/block_id OR discussion_id (not both). See https://developers.notion.com/reference/create-a-comment',
        });
      }
      if (!text) {
        return JSON.stringify({ error: 'text is required' });
      }

      const body: Record<string, unknown> = { rich_text: buildRichText(text) };
      if (discussionId) {
        body.discussion_id = discussionId;
      } else if (blockId) {
        body.parent = { type: 'block_id', block_id: blockId };
      } else {
        body.parent = { type: 'page_id', page_id: pageId };
      }

      const comment = notionApi.createComment(body);
      const rec = comment as Record<string, unknown>;

      return JSON.stringify({ object: rec.object || 'comment', id: rec.id });
    } catch (e) {
      return JSON.stringify({ error: formatApiError(e) });
    }
  },
};
