// Tool: get-email
// Get full details of a specific email by ID
import { isSensitiveText } from '../../../helpers';
import { gmailFetch } from '../api/index';
import { getEmailById, upsertEmail } from '../db/helpers';
import { getGmailSkillState } from '../state';
import type { GmailMessage } from '../types';

export const getEmailTool: ToolDefinition = {
  name: 'get-email',
  description:
    'Get full details of a specific email by its ID, including headers, body content, and attachments.',
  input_schema: {
    type: 'object',
    properties: {
      message_id: { type: 'string', description: 'The Gmail message ID to retrieve' },
      format: {
        type: 'string',
        enum: ['full', 'metadata', 'minimal'],
        description: 'Message format level (default: full)',
      },
      include_body: { type: 'boolean', description: 'Include email body content (default: true)' },
    },
    required: ['message_id'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      const messageId = args.message_id as string;
      if (!messageId) {
        return JSON.stringify({ success: false, error: 'message_id is required' });
      }

      const format = (args.format as string) || 'full';
      const includeBody = args.include_body !== false;

      // First check if email exists in local database
      const localEmail = getEmailById(messageId);

      // Get email from Gmail API
      const params: string[] = [];
      params.push(`format=${encodeURIComponent(format)}`);

      const response = gmailFetch<GmailMessage>(
        `/users/me/messages/${messageId}?${params.join('&')}`
      );

      if (!response.success) {
        return JSON.stringify({
          success: false,
          error: (response.error ? response.error.message : null) || 'Failed to fetch email',
        });
      }

      const message = response.data as GmailMessage;

      // Parse email content
      const headers = (message.payload && message.payload.headers) || [];
      const result: any = {
        id: message.id,
        thread_id: message.threadId,
        label_ids: message.labelIds || [],
        snippet: message.snippet,
        size_estimate: message.sizeEstimate || 0,
        history_id: message.historyId,
        internal_date: new Date(parseInt(message.internalDate)).toISOString(),
      };

      // Extract headers
      const headerMap: Record<string, string> = {};
      headers.forEach((header: any) => {
        headerMap[header.name.toLowerCase()] = header.value;
      });

      result.headers = {
        from: headerMap.from || '',
        to: headerMap.to || '',
        cc: headerMap.cc || '',
        bcc: headerMap.bcc || '',
        subject: headerMap.subject || '',
        date: headerMap.date || '',
        message_id: headerMap['message-id'] || '',
        in_reply_to: headerMap['in-reply-to'] || '',
        references: headerMap.references || '',
      };

      // Parse sender information
      const from = result.headers.from;
      const fromMatch = from.match(/(.+?)\s*<([^>]+)>/) || [null, from, from];
      result.sender = {
        name: (fromMatch[1] ? fromMatch[1].trim().replace(/^["']|["']$/g, '') : null) || null,
        email: (fromMatch[2] ? fromMatch[2].trim() : null) || from,
      };

      // Parse recipients
      result.recipients = {
        to: parseEmailAddresses(result.headers.to),
        cc: parseEmailAddresses(result.headers.cc),
        bcc: parseEmailAddresses(result.headers.bcc),
      };

      // Status flags
      result.status = {
        is_read: !(message.labelIds && message.labelIds.includes('UNREAD')),
        is_important: message.labelIds && message.labelIds.includes('IMPORTANT'),
        is_starred: message.labelIds && message.labelIds.includes('STARRED'),
        is_draft: message.labelIds && message.labelIds.includes('DRAFT'),
        is_sent: message.labelIds && message.labelIds.includes('SENT'),
        is_spam: message.labelIds && message.labelIds.includes('SPAM'),
        is_trash: message.labelIds && message.labelIds.includes('TRASH'),
      };

      // Extract body content if requested
      if (includeBody && format === 'full') {
        const bodyContent = extractEmailBodies(message.payload);
        result.body = bodyContent;
      }

      // Extract attachments
      const attachments = extractAttachmentInfo(message.payload);
      result.attachments = attachments;
      result.has_attachments = attachments.length > 0;

      // Update local database
      upsertEmail(message);

      // Include local database info if available
      if (localEmail) {
        result.local_info = {
          created_at: new Date(localEmail.created_at * 1000).toISOString(),
          updated_at: new Date(localEmail.updated_at * 1000).toISOString(),
        };
      }

      // If sensitive and user has not opted in to show sensitive, return redacted response.
      // Consistent with search-emails: only check subject and snippet (not full body).
      const s = getGmailSkillState();
      const showSensitive =
        s.config.showSensitiveMessages !== null && s.config.showSensitiveMessages !== undefined
          ? s.config.showSensitiveMessages
          : false;
      if (!showSensitive) {
        const textToCheck =
          ((result.headers && result.headers.subject) || '') + ' ' + (result.snippet || '');
        if (isSensitiveText(textToCheck)) {
          return JSON.stringify({
            success: true,
            email: {
              id: result.id,
              subject: '[Sensitive - hidden]',
              snippet: null,
              body: null,
              sensitive_hidden: true,
            },
          });
        }
      }

      return JSON.stringify({ success: true, email: result });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

/**
 * Helper: Parse email addresses from header string
 */
function parseEmailAddresses(headerValue: string): Array<{ email: string; name?: string }> {
  if (!headerValue) return [];

  const addresses: Array<{ email: string; name?: string }> = [];

  // Split by comma, but be careful of commas within quoted names
  const parts = headerValue.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);

  parts.forEach(part => {
    const trimmed = part.trim();
    if (!trimmed) return;

    const match = trimmed.match(/(.+?)\s*<([^>]+)>/) || [null, trimmed, trimmed];
    const name = (match[1] ? match[1].trim().replace(/^["']|["']$/g, '') : undefined) || undefined;
    const email = (match[2] ? match[2].trim() : null) || trimmed;

    addresses.push({ email, name: name !== email ? name : undefined });
  });

  return addresses;
}

/**
 * Helper: Extract email body content
 */
function extractEmailBodies(payload: any): { text?: string; html?: string } {
  const result: { text?: string; html?: string } = {};

  if (payload.body && payload.body.data) {
    if (payload.mimeType === 'text/plain') {
      result.text = atob(payload.body.data);
    } else if (payload.mimeType === 'text/html') {
      result.html = atob(payload.body.data);
    }
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.body && part.body.data) {
        if (part.mimeType === 'text/plain' && !result.text) {
          result.text = atob(part.body.data);
        } else if (part.mimeType === 'text/html' && !result.html) {
          result.html = atob(part.body.data);
        }
      }

      // Recursively check nested parts
      if (part.parts) {
        const nested = extractEmailBodies(part);
        if (nested.text && !result.text) result.text = nested.text;
        if (nested.html && !result.html) result.html = nested.html;
      }
    }
  }

  return result;
}

/**
 * Helper: Extract attachment information
 */
function extractAttachmentInfo(
  payload: any
): Array<{
  attachment_id?: string;
  filename: string;
  mime_type: string;
  size: number;
  part_id: string;
}> {
  const attachments: Array<{
    attachment_id?: string;
    filename: string;
    mime_type: string;
    size: number;
    part_id: string;
  }> = [];

  function processPayload(part: any) {
    if (part.filename && part.filename.length > 0) {
      attachments.push({
        attachment_id: part.body ? part.body.attachmentId : undefined,
        filename: part.filename,
        mime_type: part.mimeType,
        size: (part.body ? part.body.size : 0) || 0,
        part_id: part.partId,
      });
    }

    if (part.parts) {
      part.parts.forEach(processPayload);
    }
  }

  processPayload(payload);
  return attachments;
}
