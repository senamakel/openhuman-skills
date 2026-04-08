// Tool: notion-sync-now
// Triggers an immediate sync and returns the result
import { getNotionSkillState } from '../state';
import { performSync } from '../sync';

export const syncNowTool: ToolDefinition = {
  name: 'sync-now',
  description:
    'Trigger an immediate Notion sync to refresh local data. ' +
    'Returns sync results including counts of synced pages and databases.',
  input_schema: { type: 'object', properties: {} },
  execute(): string {
    try {
      const s = getNotionSkillState();

      if (!oauth.getCredential()) {
        return JSON.stringify({
          success: false,
          error: 'Notion not connected. Complete OAuth setup first.',
        });
      }

      if (s.syncStatus.syncInProgress) {
        return JSON.stringify({
          success: false,
          message: 'Sync already in progress',
          sync_in_progress: true,
          last_sync_time: s.syncStatus.lastSyncTime
            ? new Date(s.syncStatus.lastSyncTime).toISOString()
            : null,
        });
      }

      performSync();

      // Return results after sync completes
      return JSON.stringify({
        success: !s.syncStatus.lastSyncError,
        duration_ms: s.syncStatus.lastSyncDurationMs,
        last_sync_time: s.syncStatus.lastSyncTime
          ? new Date(s.syncStatus.lastSyncTime).toISOString()
          : null,
        error: s.syncStatus.lastSyncError,
        totals: {
          pages: s.syncStatus.totalPages,
          databases: s.syncStatus.totalDatabases,
          pages_with_content: s.syncStatus.pagesWithContent,
        },
      });
    } catch (e) {
      return JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
};
