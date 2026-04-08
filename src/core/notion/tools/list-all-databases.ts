// Tool: notion-list-databases
import { notionApi } from '../api/index';
import { getLocalDatabases } from '../db/helpers';
import { formatApiError, formatDatabaseSummary } from '../helpers';
import { isCacheFresh } from './cache';

export const listDatabasesTool: ToolDefinition = {
  name: 'list-databases',
  description:
    'List databases in the workspace. Returns one page of results. Set tryCache=true to use locally synced databases when available (faster).',
  input_schema: {
    type: 'object',
    properties: {
      page_size: { type: 'number', description: 'Number of results (default 20, max 100)' },
      tryCache: {
        type: 'boolean',
        description:
          'If true, return locally cached databases when cache is fresh (synced within 3 hours)',
      },
    },
  },
  execute(args: Record<string, unknown>): string {
    try {
      const pageSize = Math.min((args.page_size as number) || 20, 100);
      const tryCache = args.tryCache === true;

      if (tryCache && isCacheFresh()) {
        const localDbs = getLocalDatabases({ limit: pageSize });
        if (localDbs.length > 0) {
          const databases = localDbs.map(d => ({
            id: d.id,
            title: d.title,
            url: d.url,
            created_time: d.created_time,
            last_edited_time: d.last_edited_time,
            property_count: d.property_count,
          }));
          return JSON.stringify({
            count: databases.length,
            has_more: localDbs.length >= pageSize,
            databases,
            source: 'cache',
          });
        }
      }

      const result = notionApi.listAllDatabases(pageSize);
      const databases = result.results.map((item: Record<string, unknown>) =>
        formatDatabaseSummary(item)
      );
      return JSON.stringify({
        count: databases.length,
        has_more: result.has_more,
        databases,
        source: 'api',
      });
    } catch (e) {
      return JSON.stringify({ error: formatApiError(e) });
    }
  },
};
