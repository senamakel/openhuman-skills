// Tool: search-emails
// Advanced email search using Gmail query syntax
import { isSensitiveText } from '../../../helpers';
import { gmailFetch } from '../api/index';
import { upsertEmail } from '../db/helpers';
import { getGmailSkillState } from '../state';
import type { GmailMessage } from '../types';

export const searchEmailsTool: ToolDefinition = {
  name: 'search-emails',
  description:
    'Search emails using advanced Gmail query syntax. Supports complex queries with operators like from:, to:, subject:, has:attachment, is:unread, etc.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Gmail search query (e.g., "from:john@example.com subject:meeting is:unread", "has:attachment after:2023/01/01")',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (default: 20, max: 100)',
        minimum: 1,
        maximum: 100,
      },
      include_spam_trash: {
        type: 'boolean',
        description: 'Include results from spam and trash folders (default: false)',
      },
      page_token: { type: 'string', description: 'Token for pagination (from previous search)' },
    },
    required: ['query'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      const query = args.query as string;
      if (!query) {
        return JSON.stringify({ success: false, error: 'Search query is required' });
      }

      // Build API parameters
      const params: string[] = [];
      params.push(`q=${encodeURIComponent(query)}`);

      const maxResults = Math.min(parseInt((args.max_results as string) || '20', 10), 100);
      params.push(`maxResults=${maxResults}`);

      if (args.include_spam_trash) {
        params.push('includeSpamTrash=true');
      }

      if (args.page_token) {
        params.push(`pageToken=${encodeURIComponent(args.page_token as string)}`);
      }

      // Search messages
      const searchResponse = gmailFetch<{
        messages?: Array<{ id: string; threadId: string }>;
        nextPageToken?: string;
        resultSizeEstimate: number;
      }>(`/users/me/messages?${params.join('&')}`);

      if (!searchResponse.success || !searchResponse.data) {
        return JSON.stringify({
          success: false,
          error: (searchResponse.error ? searchResponse.error.message : null) || 'Search failed',
        });
      }

      const searchResults = searchResponse.data;

      if (!searchResults.messages || searchResults.messages.length === 0) {
        return JSON.stringify({
          success: true,
          emails: [],
          query,
          total_estimate: searchResults.resultSizeEstimate || 0,
          next_page_token: null,
        });
      }

      // Fetch message metadata in parallel (max 5 concurrent) to avoid
      // sequential proxy round-trips that cause timeouts.
      const CONCURRENCY = 5;
      const emails = [];
      const refs = searchResults.messages;

      for (let i = 0; i < refs.length; i += CONCURRENCY) {
        const batch = refs.slice(i, i + CONCURRENCY);
        const results = batch.map(msgRef =>
          gmailFetch<GmailMessage>(
            `/users/me/messages/${msgRef.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`
          )
        );

        for (const msgResponse of results) {
          if (msgResponse.success && msgResponse.data) {
            const message = msgResponse.data as GmailMessage;
            const headers = (message.payload && message.payload.headers) || [];

            const headerMap: Record<string, string> = {};
            headers.forEach((header: any) => {
              headerMap[header.name.toLowerCase()] = header.value;
            });

            const from = headerMap.from || '';
            const fromMatch = from.match(/(.+?)\s*<([^>]+)>/) || [null, from, from];
            const senderName =
              (fromMatch[1] ? fromMatch[1].trim().replace(/^["']|["']$/g, '') : null) || null;
            const senderEmail = (fromMatch[2] ? fromMatch[2].trim() : null) || from;

            emails.push({
              id: message.id,
              thread_id: message.threadId,
              subject: headerMap.subject || '',
              sender: { email: senderEmail, name: senderName },
              recipients: headerMap.to || '',
              date: headerMap.date
                ? new Date(headerMap.date).toISOString()
                : new Date(parseInt(message.internalDate)).toISOString(),
              snippet: message.snippet,
              label_ids: message.labelIds || [],
              size_estimate: message.sizeEstimate || 0,
              status: {
                is_read: !(message.labelIds && message.labelIds.includes('UNREAD')),
                is_important: message.labelIds && message.labelIds.includes('IMPORTANT'),
                is_starred: message.labelIds && message.labelIds.includes('STARRED'),
                has_attachments: hasAttachments(message),
              },
              relevance_score: calculateRelevanceScore(message, query),
            });

            upsertEmail(message);
          }
        }
      }

      // Filter out sensitive emails unless user opted in to show them
      const s = getGmailSkillState();
      const showSensitive =
        s.config.showSensitiveMessages !== null && s.config.showSensitiveMessages !== undefined
          ? s.config.showSensitiveMessages
          : false;
      const filteredEmails = showSensitive
        ? emails
        : emails.filter(
            (e: { subject?: string; snippet?: string }) =>
              !isSensitiveText((e.subject || '') + ' ' + (e.snippet || ''))
          );

      // Sort by relevance score (highest first)
      filteredEmails.sort((a, b) => b.relevance_score - a.relevance_score);

      return JSON.stringify({
        success: true,
        emails: filteredEmails,
        query,
        total_estimate: searchResults.resultSizeEstimate,
        returned_count: filteredEmails.length,
        next_page_token: searchResults.nextPageToken || null,
        search_tips: generateSearchTips(query),
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};

/**
 * Helper: Check if message has attachments
 */
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

/**
 * Helper: Calculate relevance score based on query matching
 */
function calculateRelevanceScore(message: any, query: string): number {
  let score = 0;
  const queryLower = query.toLowerCase();

  // Check subject relevance
  const payloadHeaders = (message.payload && message.payload.headers) || [];
  const subjectHeader = payloadHeaders.find((h: any) => h.name.toLowerCase() === 'subject');
  const subject = (subjectHeader ? subjectHeader.value : '') || '';
  if (subject.toLowerCase().includes(queryLower)) {
    score += 10;
  }

  // Check snippet relevance
  if (message.snippet && message.snippet.toLowerCase().includes(queryLower)) {
    score += 5;
  }

  // Boost score for unread messages
  if (message.labelIds && message.labelIds.includes('UNREAD')) {
    score += 3;
  }

  // Boost score for important messages
  if (message.labelIds && message.labelIds.includes('IMPORTANT')) {
    score += 5;
  }

  // Boost score for recent messages
  const messageDate = new Date(parseInt(message.internalDate));
  const daysSinceMessage = (Date.now() - messageDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceMessage < 7) {
    score += 2;
  }

  return score;
}

/**
 * Helper: Generate search tips based on the query
 */
function generateSearchTips(query: string): string[] {
  const tips: string[] = [];

  if (!query.includes(':')) {
    tips.push('Use operators like "from:", "to:", "subject:" for more precise searches');
  }

  if (!query.includes('has:')) {
    tips.push('Use "has:attachment" to find emails with attachments');
  }

  if (!query.includes('is:')) {
    tips.push('Use "is:unread", "is:important", or "is:starred" to filter by status');
  }

  if (!query.includes('after:') && !query.includes('before:')) {
    tips.push('Use "after:2023/01/01" or "before:2023/12/31" to filter by date');
  }

  if (!query.includes('label:')) {
    tips.push('Use "label:inbox" or "label:sent" to search within specific labels');
  }

  return tips.slice(0, 3); // Return max 3 tips
}
