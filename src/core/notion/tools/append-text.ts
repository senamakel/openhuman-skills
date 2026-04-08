// Tool: notion-append-text
import { notionApi } from '../api/index';
import { buildParagraphBlock, formatApiError, formatBlockSummary } from '../helpers';

export const appendTextTool: ToolDefinition = {
  name: 'append-text',
  description:
    'Append text content to a page or block. Use the page id (or block_id) from list-all-pages or get-page. Creates paragraph blocks with the given text.',
  input_schema: {
    type: 'object',
    properties: {
      block_id: {
        type: 'string',
        description: 'The page or block ID to append to (use page id from list-all-pages)',
      },
      page_id: {
        type: 'string',
        description: 'Alias for block_id when appending to a page (same as block_id)',
      },
      text: {
        type: 'string',
        description: 'The text to append (required). Pass the exact content to add to the page.',
      },
      content: {
        type: 'string',
        description: 'Alias for text — the content to append to the page',
      },
    },
    required: ['text'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      const blockId = (args.block_id as string) || (args.page_id as string) || '';
      const _textVal =
        args.text !== undefined && args.text !== null
          ? args.text
          : args.content !== undefined && args.content !== null
            ? args.content
            : '';
      const text = String(_textVal).trim();

      if (!blockId) {
        return JSON.stringify({
          success: false,
          error:
            'block_id or page_id is required. Use the page id from list-all-pages or get-page.',
        });
      }
      if (!text) {
        return JSON.stringify({
          success: false,
          error:
            'text (or content) is required and cannot be empty. Pass the string to append, e.g. { "block_id": "<page-id>", "text": "Your content here" }.',
        });
      }

      const paragraphs = text.split('\n').filter(p => p.trim());
      const children = paragraphs.map(buildParagraphBlock);

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
