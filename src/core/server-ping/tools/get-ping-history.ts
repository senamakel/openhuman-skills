// Tool: get-ping-history
// Get recent ping history from the database. Returns the last N ping results.

declare const db: { all: (sql: string, params: unknown[]) => unknown[] };

export const getPingHistoryTool: ToolDefinition = {
  name: 'get-ping-history',
  description: 'Get recent ping history from the database. Returns the last N ping results.',
  input_schema: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Number of recent pings to return (default 20, max 100)',
      },
    },
  },
  execute(args: Record<string, unknown>): string {
    const limit = Math.min(Math.max(parseInt(args.limit as string) || 20, 1), 100);
    const rows = db.all(
      'SELECT timestamp, url, status, latency_ms, success, error FROM ping_log ORDER BY id DESC LIMIT ?',
      [limit]
    );
    return JSON.stringify({ count: rows.length, history: rows });
  },
};
