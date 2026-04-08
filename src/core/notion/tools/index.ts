import { appendBlocksTool } from './append-blocks';
import { appendTextTool } from './append-text';
import { createCommentTool } from './create-comment';
import { createDatabaseTool } from './create-database';
import { createPageTool } from './create-page';
import { deleteBlockTool } from './delete-block';
import { deletePageTool } from './delete-page';
import { getBlockTool } from './get-block';
import { getBlockChildrenTool } from './get-block-children';
import { getDatabaseTool } from './get-database';
import { getPageTool } from './get-page';
import { getPageContentTool } from './get-page-content';
import { getUserTool } from './get-user';
import { listDatabasesTool } from './list-all-databases';
import { listPagesTool } from './list-all-pages';
import { listCommentsTool } from './list-comments';
import { listUsersTool } from './list-users';
import { queryDatabaseTool } from './query-database';
import { searchTool } from './search';
import { summarizePagesTool } from './summarize-pages';
import { syncNowTool } from './sync-now';
import { syncStatusTool } from './sync-status';
import { updateBlockTool } from './update-block';
import { updateDatabaseTool } from './update-database';
import { updatePageTool } from './update-page';

/**
 * Wrap a tool's execute function with entry/exit logging.
 * Logs: tool name, args summary, elapsed time, result size or error.
 */
function withLogging(tool: ToolDefinition): ToolDefinition {
  const originalExecute = tool.execute;
  const toolName = tool.name;
  return {
    ...tool,
    execute(args: Record<string, unknown>): string {
      const argKeys = Object.keys(args || {});
      const argSummary =
        argKeys.length > 0
          ? argKeys
              .map(k => {
                const v = args[k];
                if (typeof v === 'string') return `${k}=<${v.length} chars>`;
                if (Array.isArray(v)) return `${k}=<array ${v.length}>`;
                if (v && typeof v === 'object') return `${k}=<object>`;
                return `${k}=${JSON.stringify(v)}`;
              })
              .join(', ')
          : '(none)';
      console.log(`[notion][tool:${toolName}] called with ${argSummary}`);

      const t0 = Date.now();
      try {
        const text = originalExecute.call(this, args) as string;
        const ms = Date.now() - t0;
        const len = text ? text.length : 0;
        let errMsg = '';
        try {
          const parsed = JSON.parse(text);
          if (parsed.error) errMsg = ` error="${String(parsed.error).slice(0, 100)}"`;
        } catch {
          /* not JSON */
        }
        console.log(`[notion][tool:${toolName}] OK ${ms}ms (${len}b)${errMsg}`);
        return text;
      } catch (e) {
        const ms = Date.now() - t0;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[notion][tool:${toolName}] FAILED ${ms}ms: ${msg}`);
        throw e;
      }
    },
  };
}

const rawTools: ToolDefinition[] = [
  appendBlocksTool,
  appendTextTool,
  createCommentTool,
  createDatabaseTool,
  createPageTool,
  deleteBlockTool,
  deletePageTool,
  getBlockTool,
  getBlockChildrenTool,
  getDatabaseTool,
  getPageTool,
  getPageContentTool,
  getUserTool,
  listDatabasesTool,
  listPagesTool,
  listCommentsTool,
  listUsersTool,
  queryDatabaseTool,
  searchTool,
  summarizePagesTool,
  syncNowTool,
  syncStatusTool,
  updateBlockTool,
  updateDatabaseTool,
  updatePageTool,
];

export const tools: ToolDefinition[] = rawTools.map(withLogging);

export default tools;
