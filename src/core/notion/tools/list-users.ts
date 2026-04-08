// Tool: notion-list-users
import { notionApi } from '../api/index';
import { getLocalUsers } from '../db/helpers';
import { formatApiError, formatUserSummary } from '../helpers';
import { isCacheFresh } from './cache';

export const listUsersTool: ToolDefinition = {
  name: 'list-users',
  description:
    'List users in the workspace. Returns one page of results (up to 100). Set tryCache=true to use locally synced users when available (faster).',
  input_schema: {
    type: 'object',
    properties: {
      page_size: { type: 'number', description: 'Number of results (default 100, max 100)' },
      tryCache: {
        type: 'boolean',
        description:
          'If true, return locally cached users when cache is fresh (synced within 3 hours)',
      },
    },
  },
  execute(args: Record<string, unknown>): string {
    try {
      const pageSize = Math.min((args.page_size as number) || 100, 100);
      const tryCache = args.tryCache === true;

      if (tryCache && isCacheFresh()) {
        const localUsers = getLocalUsers();
        if (localUsers.length > 0) {
          const users = localUsers.map(u => ({
            id: u.id,
            name: u.name,
            email: u.email,
            type: u.user_type,
            avatar_url: u.avatar_url,
          }));
          return JSON.stringify({ count: users.length, users, source: 'cache' });
        }
      }

      const result = notionApi.listUsers(pageSize);
      const users = result.results.map((u: Record<string, unknown>) => formatUserSummary(u));
      return JSON.stringify({
        count: users.length,
        has_more: result.has_more,
        users,
        source: 'api',
      });
    } catch (e) {
      return JSON.stringify({ error: formatApiError(e) });
    }
  },
};
