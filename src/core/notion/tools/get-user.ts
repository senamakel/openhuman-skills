// Tool: notion-get-user
import { notionApi } from '../api/index';
import { formatApiError, formatUserSummary } from '../helpers';

export const getUserTool: ToolDefinition = {
  name: 'get-user',
  description: 'Get a user by their ID.',
  input_schema: {
    type: 'object',
    properties: { user_id: { type: 'string', description: 'The user ID' } },
    required: ['user_id'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      const userId = (args.user_id as string) || '';

      if (!userId) {
        return JSON.stringify({ error: 'user_id is required' });
      }

      const user = notionApi.getUser(userId);
      const summary = formatUserSummary(user as Record<string, unknown>);
      return JSON.stringify(summary);
    } catch (e) {
      console.error('[notion][tool:get-user] Error while fetching user:', e);
      return JSON.stringify({ error: formatApiError(e) });
    }
  },
};
