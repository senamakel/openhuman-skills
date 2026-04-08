// Tool: notion-create-page
import { notionApi } from '../api/index';
import { buildParagraphBlock, buildRichText, formatApiError, formatPageSummary } from '../helpers';

export const createPageTool: ToolDefinition = {
  name: 'create-page',
  description:
    'Create a new page in Notion. Parent can be another page or a database. ' +
    'For database parents, properties must match the database schema.',
  input_schema: {
    type: 'object',
    properties: {
      parent_id: { type: 'string', description: 'Parent page ID or database ID' },
      parent_type: {
        type: 'string',
        enum: ['page_id', 'database_id'],
        description: 'Type of parent (default: page_id)',
      },
      title: { type: 'string', description: 'Page title' },
      content: { type: 'string', description: 'Initial text content (creates a paragraph block)' },
      properties: {
        type: 'string',
        description: 'JSON string of additional properties (for database pages)',
      },
    },
    required: ['parent_id', 'title'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      const parentId = (args.parent_id as string) || '';
      const parentType = (args.parent_type as string) || 'page_id';
      const title = (args.title as string) || '';
      const content = args.content as string | undefined;
      const propsJson = args.properties as string | undefined;

      if (!parentId) {
        return JSON.stringify({ error: 'parent_id is required' });
      }
      if (!title) {
        return JSON.stringify({ error: 'title is required' });
      }

      let parentPayload: Record<string, unknown>;
      if (parentType === 'database_id') {
        const dataSourceId = notionApi.resolveDataSourceId(parentId);
        parentPayload = { data_source_id: dataSourceId };
      } else {
        parentPayload = { [parentType]: parentId };
      }
      const body: Record<string, unknown> = { parent: parentPayload };

      if (parentType === 'database_id') {
        let props: Record<string, unknown> = { Name: { title: buildRichText(title) } };
        if (propsJson) {
          try {
            const additional = JSON.parse(propsJson);
            props = { ...props, ...additional };
          } catch {
            return JSON.stringify({ error: 'Invalid properties JSON' });
          }
        }
        body.properties = props;
      } else {
        body.properties = { title: { title: buildRichText(title) } };
      }

      // The Notion API rejects `children` when the parent is a database —
      // content must be appended after page creation.
      const appendContentAfterCreate = parentType === 'database_id' && !!content;
      if (content && !appendContentAfterCreate) {
        body.children = [buildParagraphBlock(content)];
      }

      const page = notionApi.createPage(body);
      const pageId = (page as Record<string, unknown>).id as string;

      if (appendContentAfterCreate && content) {
        notionApi.appendBlockChildren(pageId, [buildParagraphBlock(content)]);
      }

      return JSON.stringify({
        success: true,
        page: formatPageSummary(page as Record<string, unknown>),
      });
    } catch (e) {
      return JSON.stringify({ error: formatApiError(e) });
    }
  },
};
