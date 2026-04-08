// Tool: notion-query-database
import { notionApi } from '../api/index';
import { formatApiError, formatPageSummary } from '../helpers';

export const queryDatabaseTool: ToolDefinition = {
  name: 'query-database',
  description: 'Query a database with optional filters and sorts. Returns database rows/pages.',
  input_schema: {
    type: 'object',
    properties: {
      database_id: { type: 'string', description: 'The database ID to query' },
      filter: {
        type: 'string',
        description: 'JSON string of filter object (Notion filter syntax)',
      },
      sorts: { type: 'string', description: 'JSON string of sorts array (Notion sort syntax)' },
      page_size: { type: 'number', description: 'Number of results (default 20, max 100)' },
    },
    required: ['database_id'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      const databaseId = (args.database_id as string) || '';
      const filterJson = args.filter as string | undefined;
      const sortsJson = args.sorts as string | undefined;
      const pageSize = Math.min((args.page_size as number) || 20, 100);

      if (!databaseId) {
        return JSON.stringify({ error: 'database_id is required' });
      }

      const body: Record<string, unknown> = { page_size: pageSize };

      if (filterJson) {
        try {
          body.filter = JSON.parse(filterJson);
        } catch {
          return JSON.stringify({ error: 'Invalid filter JSON' });
        }
      }

      if (sortsJson) {
        try {
          body.sorts = JSON.parse(sortsJson);
        } catch {
          return JSON.stringify({ error: 'Invalid sorts JSON' });
        }
      }

      const result = notionApi.queryDataSource(databaseId, body);

      const rows = result.results.map((page: Record<string, unknown>) => {
        return { ...formatPageSummary(page), properties: page.properties };
      });

      return JSON.stringify({ count: rows.length, has_more: result.has_more, rows });
    } catch (e) {
      const error = formatApiError(e);
      console.error(`[notion][query-database] Error querying database ${args.database_id}:`, e);

      return JSON.stringify({ error, database_id: args.database_id });
    }
  },
};

export { queryDatabaseTool as default };
