// Tool: gmail-get-emails
// Get emails with filtering and search.
import { isSensitiveText } from '../../../helpers';
import { GmailApiResponse, gmailFetch } from '../api/index';
import { upsertEmail } from '../db/helpers';
import { getGmailSkillState } from '../state';
import { GmailMessage } from '../types';

function buildListParams(args: Record<string, unknown>): string[] {
  const params: string[] = [];
  if (args.query) {
    params.push(`q=${encodeURIComponent(args.query as string)}`);
  }
  if (args.label_ids && Array.isArray(args.label_ids)) {
    (args.label_ids as string[]).forEach((labelId: string) => {
      params.push(`labelIds=${encodeURIComponent(labelId)}`);
    });
  }
  const maxResults = Math.min(
    parseInt(
      String(
        args.max_results !== null && args.max_results !== undefined
          ? args.max_results
          : args.maxResults !== null && args.maxResults !== undefined
            ? args.maxResults
            : 20
      ),
      10
    ) || 20,
    100
  );
  params.push(`maxResults=${maxResults}`);
  if (args.include_spam_trash) {
    params.push('includeSpamTrash=true');
  }
  if (args.page_token) {
    params.push(`pageToken=${encodeURIComponent(args.page_token as string)}`);
  }
  return params;
}

function hasAttachments(message: any): boolean {
  if (message.payload && message.payload.body && message.payload.body.attachmentId) return true;
  if (message.payload && message.payload.parts) {
    return message.payload.parts.some(
      (part: any) =>
        (part.body && part.body.attachmentId) || (part.filename && part.filename.length > 0)
    );
  }
  return false;
}

function messageToEmailRow(message: any): Record<string, unknown> {
  const headers = (message.payload && message.payload.headers) || [];
  const getHeader = (name: string) => {
    const found = headers.find(
      (h: { name: string }) => h.name.toLowerCase() === name.toLowerCase()
    );
    return (found ? found.value : '') || '';
  };
  const subject = getHeader('Subject');
  const from = getHeader('From');
  const to = getHeader('To');
  const date = getHeader('Date');
  const fromMatch = from.match(/(.+?)\s*<([^>]+)>/) || [null, from, from];
  const senderName =
    ((fromMatch[1] ? fromMatch[1].trim().replace(/^["']|["']$/g, '') : null) as string) || null;
  const senderEmail = ((fromMatch[2] ? fromMatch[2].trim() : null) as string) || from;

  return {
    id: message.id,
    thread_id: message.threadId,
    subject,
    sender: { email: senderEmail, name: senderName },
    recipients: to,
    date: date
      ? new Date(date).toISOString()
      : new Date(parseInt(message.internalDate, 10)).toISOString(),
    snippet: message.snippet,
    label_ids: message.labelIds || [],
    is_read: !(message.labelIds && message.labelIds.includes('UNREAD')),
    is_important: message.labelIds && message.labelIds.includes('IMPORTANT'),
    is_starred: message.labelIds && message.labelIds.includes('STARRED'),
    has_attachments: hasAttachments(message),
    size_estimate: message.sizeEstimate || 0,
  };
}

export const getEmailsTool: ToolDefinition = {
  name: 'get-emails',
  description:
    'Get emails from Gmail with optional filtering by query, labels, and pagination. Supports Gmail search syntax. When accessToken is provided (e.g. from frontend after OAuth), uses it directly; otherwise uses the skill OAuth credential.',
  input_schema: {
    type: 'object',
    properties: {
      accessToken: {
        type: 'string',
        description:
          'Optional OAuth access token. When provided (e.g. by frontend after OAuth), Gmail API is called directly with this token instead of the skill credential.',
      },
      query: {
        type: 'string',
        description:
          'Search query using Gmail search syntax (e.g., "from:example@gmail.com", "subject:meeting", "is:unread")',
      },
      label_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by specific label IDs (e.g., ["INBOX", "IMPORTANT"])',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of emails to return (default: 20, max: 100)',
        minimum: 1,
        maximum: 100,
      },
      maxResults: {
        type: 'number',
        description: 'Alias for max_results (e.g. for frontend calls)',
      },
      include_spam_trash: {
        type: 'boolean',
        description: 'Include emails from spam and trash (default: false)',
      },
      page_token: {
        type: 'string',
        description: 'Token for pagination (returned from previous request)',
      },
    },
    required: [],
  },
  execute(args: Record<string, unknown>): string {
    const params = buildListParams(args);
    const listEndpoint = `/users/me/messages?${params.join('&')}`;

    const listResponse: GmailApiResponse<{
      messages?: Array<{ id: string; threadId: string }>;
      nextPageToken?: string;
      resultSizeEstimate: number;
    }> = gmailFetch(listEndpoint);

    if (!listResponse.success) {
      return JSON.stringify({
        success: false,
        error:
          (listResponse.error ? listResponse.error.message : null) || 'Failed to fetch email list',
      });
    }

    const messageList = listResponse.data as {
      messages?: Array<{ id: string; threadId: string }>;
      nextPageToken?: string;
      resultSizeEstimate: number;
    };

    if (!messageList.messages || messageList.messages.length === 0) {
      return JSON.stringify({
        success: true,
        emails: [],
        total_count:
          messageList.resultSizeEstimate !== null && messageList.resultSizeEstimate !== undefined
            ? messageList.resultSizeEstimate
            : 0,
        next_page_token: messageList.nextPageToken || null,
        query: args.query || null,
        label_ids: args.label_ids || null,
      });
    }

    // Fetch message metadata in parallel (max 5 concurrent) to avoid
    // sequential proxy round-trips that cause timeouts.
    const CONCURRENCY = 5;
    const emails: Record<string, unknown>[] = [];
    const refs = messageList.messages;

    for (let i = 0; i < refs.length; i += CONCURRENCY) {
      const batch = refs.slice(i, i + CONCURRENCY);
      const results = batch.map(msgRef => {
        const msgEndpoint = `/users/me/messages/${msgRef.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`;
        return gmailFetch<GmailMessage>(msgEndpoint);
      });
      for (const msgResponse of results) {
        if (msgResponse.success && msgResponse.data) {
          const message = msgResponse.data as any;
          emails.push(messageToEmailRow(message));
          upsertEmail(message);
        }
      }
    }

    const s = getGmailSkillState();
    const showSensitive =
      s.config.showSensitiveMessages !== null && s.config.showSensitiveMessages !== undefined
        ? s.config.showSensitiveMessages
        : false;
    const filteredEmails = showSensitive
      ? emails
      : emails.filter(
          (e: Record<string, unknown>) =>
            !isSensitiveText(((e.subject as string) || '') + ' ' + ((e.snippet as string) || ''))
        );

    return JSON.stringify({
      success: true,
      emails: filteredEmails,
      total_count:
        messageList.resultSizeEstimate !== null && messageList.resultSizeEstimate !== undefined
          ? messageList.resultSizeEstimate
          : 0,
      next_page_token: messageList.nextPageToken || null,
      query: args.query || null,
      label_ids: args.label_ids || null,
    });
  },
};
