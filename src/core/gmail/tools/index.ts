import { getEmailTool } from './get-email';
import { getEmailsTool } from './get-emails';
import { getLabelsTool } from './get-labels';
import { getProfileTool } from './get-profile';
import { markEmailTool } from './mark-email';
import { searchEmailsTool } from './search-emails';
import { sendEmailTool } from './send-email';

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
      const SENSITIVE_KEYS = [
        'to',
        'cc',
        'bcc',
        'recipients',
        'body',
        'subject',
        'query',
        'search',
        'content',
      ];
      const argSummary =
        argKeys.length > 0
          ? argKeys
              .map(k => {
                const v = args[k];
                if (SENSITIVE_KEYS.indexOf(k.toLowerCase()) >= 0) return `${k}=<redacted>`;
                if (typeof v === 'string') return `${k}=<${v.length} chars>`;
                if (Array.isArray(v)) return `${k}=<array ${v.length}>`;
                if (v && typeof v === 'object') return `${k}=<object>`;
                return `${k}=${JSON.stringify(v)}`;
              })
              .join(', ')
          : '(none)';
      console.log(`[gmail][tool:${toolName}] called with ${argSummary}`);

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
        console.log(`[gmail][tool:${toolName}] OK ${ms}ms (${len}b)${errMsg}`);
        return text;
      } catch (e) {
        const ms = Date.now() - t0;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[gmail][tool:${toolName}] FAILED ${ms}ms: ${msg}`);
        throw e;
      }
    },
  };
}

const rawTools: ToolDefinition[] = [
  getEmailTool,
  getEmailsTool,
  getLabelsTool,
  getProfileTool,
  markEmailTool,
  searchEmailsTool,
  sendEmailTool,
];

export const tools: ToolDefinition[] = rawTools.map(withLogging);
