// Tool: notion-create-database
// Request: { parent: { type: "page_id", page_id }, title: [{ text: { content } }], properties? }
// Response: { object, id }
import { notionApi } from '../api/index';
import { buildRichText, formatApiError } from '../helpers';

export const createDatabaseTool: ToolDefinition = {
  name: 'create-database',
  description:
    'Create a new database in Notion. Specify parent page_id and title. ' +
    'Optionally provide properties schema as JSON.',
  input_schema: {
    type: 'object',
    properties: {
      parent_page_id: {
        type: 'string',
        description: 'Parent page ID where the database will be created',
      },
      title: { type: 'string', description: 'Database title' },
      properties: {
        type: 'string',
        description:
          'JSON string of properties schema. Example: {"Name":{"title":{}},"Status":{"select":{"options":[{"name":"Todo"},{"name":"Done"}]}}}',
      },
    },
    required: ['parent_page_id', 'title'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      const parentId = (args.parent_page_id as string) || '';
      const title = (args.title as string) || '';
      const propsJson = args.properties as string | undefined;

      if (!parentId) {
        return JSON.stringify({ error: 'parent_page_id is required' });
      }
      if (!title) {
        return JSON.stringify({ error: 'title is required' });
      }

      let properties: Record<string, unknown> = { Name: { title: {} } };
      if (propsJson) {
        try {
          properties = JSON.parse(propsJson);
        } catch {
          return JSON.stringify({ error: 'Invalid properties JSON' });
        }
      }

      const body = {
        parent: { type: 'page_id' as const, page_id: parentId },
        title: buildRichText(title),
        properties,
      };

      const dbResult = notionApi.createDatabase(body as Record<string, unknown>);
      const rec = dbResult as Record<string, unknown>;

      return JSON.stringify({ object: rec.object || 'database', id: rec.id });
    } catch (e) {
      return JSON.stringify({ error: formatApiError(e) });
    }
  },
};
