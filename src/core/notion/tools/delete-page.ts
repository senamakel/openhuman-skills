// Tool: notion-delete-page
import { notionApi } from '../api/index';
import { formatApiError, formatPageSummary } from '../helpers';

export const deletePageTool: ToolDefinition = {
  name: 'delete-page',
  description: "Delete (archive) a page. Archived pages can be restored from Notion's trash.",
  input_schema: {
    type: 'object',
    properties: { page_id: { type: 'string', description: 'The page ID to delete/archive' } },
    required: ['page_id'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      const pageId = (args.page_id as string) || '';
      if (!pageId) {
        return JSON.stringify({ error: 'page_id is required' });
      }

      const page = notionApi.archivePage(pageId);

      return JSON.stringify({
        success: true,
        message: 'Page archived',
        page: formatPageSummary(page as Record<string, unknown>),
      });
    } catch (e) {
      return JSON.stringify({ error: formatApiError(e) });
    }
  },
};
