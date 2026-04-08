// Tool: notion-search
import { notionApi } from '../api/index';
import type { SearchRequest } from '../api/search';
import { formatApiError, formatPageTitle } from '../helpers';

/** Shape of one search result item matching Notion API response. */
function toSearchResultItem(item: Record<string, unknown>): Record<string, unknown> {
  const inTrashVal =
    item.in_trash !== undefined && item.in_trash !== null
      ? item.in_trash
      : item.archived !== undefined && item.archived !== null
        ? item.archived
        : false;
  const base = {
    object: item.object,
    id: item.id,
    created_time: item.created_time,
    last_edited_time: item.last_edited_time,
    in_trash: inTrashVal,
    is_locked: item.is_locked !== undefined && item.is_locked !== null ? item.is_locked : false,
    url: item.url !== undefined && item.url !== null ? item.url : null,
    public_url: item.public_url !== undefined && item.public_url !== null ? item.public_url : null,
    parent: item.parent !== undefined && item.parent !== null ? item.parent : null,
    properties: item.properties !== undefined && item.properties !== null ? item.properties : {},
    icon: item.icon !== undefined && item.icon !== null ? item.icon : null,
    cover: item.cover !== undefined && item.cover !== null ? item.cover : null,
    created_by: item.created_by !== undefined && item.created_by !== null ? item.created_by : null,
    last_edited_by:
      item.last_edited_by !== undefined && item.last_edited_by !== null
        ? item.last_edited_by
        : null,
  };
  if (item.object === 'page') {
    return { ...base, title: formatPageTitle(item) };
  }
  if (item.object === 'database' || item.object === 'data_source') {
    const title =
      Array.isArray(item.title) && item.title.length
        ? (item.title as Array<{ plain_text?: string }>).map(t => t.plain_text || '').join('')
        : '(Untitled)';
    return { ...base, title };
  }
  return base;
}

export const searchTool: ToolDefinition = {
  name: 'search',
  description:
    'Search for pages and databases in your Notion workspace. ' +
    'Supports query, filter by object type (page or database), and sort by last_edited_time.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (optional, returns recent if empty)' },
      filter: {
        type: 'string',
        enum: ['page', 'database', 'data_source'],
        description: 'Filter results by type: page or database (data_source)',
      },
      sort_direction: {
        type: 'string',
        enum: ['ascending', 'descending'],
        description: 'Sort direction (default: descending by last_edited_time)',
      },
      page_size: {
        type: 'number',
        description: 'Number of results to return (default 20, max 100)',
      },
    },
  },
  execute(args: Record<string, unknown>): string {
    try {
      const query = ((args.query as string) || '').trim();
      const filter = args.filter as string | undefined;
      const sortDirection = (args.sort_direction as string) || 'descending';
      const pageSize = Math.min((args.page_size as number) || 20, 100);

      const body: SearchRequest = { page_size: pageSize };
      if (query) body.query = query;
      if (filter) {
        // Map 'database' to 'data_source' for the new Notion API (2025-09-03)
        const filterValue =
          filter === 'database' || filter === 'data_source' ? 'data_source' : 'page';
        body.filter = { property: 'object', value: filterValue };
      }
      body.sort = {
        direction: sortDirection === 'ascending' ? 'ascending' : 'descending',
        timestamp: 'last_edited_time',
      };

      const result = notionApi.search(body as Record<string, unknown>);
      const results = (result.results as Record<string, unknown>[]).map(toSearchResultItem);

      const resultRec = result as Record<string, unknown>;
      return JSON.stringify({
        object:
          resultRec.object !== undefined && resultRec.object !== null ? resultRec.object : 'list',
        next_cursor:
          resultRec.next_cursor !== undefined && resultRec.next_cursor !== null
            ? resultRec.next_cursor
            : null,
        has_more:
          result.has_more !== undefined && result.has_more !== null ? result.has_more : false,
        results,
      });
    } catch (e) {
      return JSON.stringify({ error: formatApiError(e) });
    }
  },
};
