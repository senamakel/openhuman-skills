// Tool: send-email
// Send emails via Gmail API with support for attachments, HTML/text, and threading
import { gmailFetch } from '../api';
import { upsertEmail } from '../db/helpers';
import { getGmailSkillState } from '../state';
import type { GmailMessage } from '../types';

export const sendEmailTool: ToolDefinition = {
  name: 'send-email',
  description:
    'Send an email through Gmail with support for HTML/text content, attachments, CC/BCC recipients, and reply threading.',
  input_schema: {
    type: 'object',
    properties: {
      to: {
        type: 'array',
        items: {
          type: 'object',
          properties: { email: { type: 'string', format: 'email' }, name: { type: 'string' } },
          required: ['email'],
        },
        description: 'Primary recipients',
      },
      cc: {
        type: 'array',
        items: {
          type: 'object',
          properties: { email: { type: 'string', format: 'email' }, name: { type: 'string' } },
          required: ['email'],
        },
        description: 'CC recipients (optional)',
      },
      bcc: {
        type: 'array',
        items: {
          type: 'object',
          properties: { email: { type: 'string', format: 'email' }, name: { type: 'string' } },
          required: ['email'],
        },
        description: 'BCC recipients (optional)',
      },
      subject: { type: 'string', description: 'Email subject line' },
      body_text: {
        type: 'string',
        description: 'Plain text email body (optional if body_html provided)',
      },
      body_html: {
        type: 'string',
        description: 'HTML email body (optional if body_text provided)',
      },
      attachments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            filename: { type: 'string' },
            data: { type: 'string', description: 'Base64 encoded file data' },
            mime_type: { type: 'string' },
          },
          required: ['filename', 'data', 'mime_type'],
        },
        description: 'File attachments (optional)',
      },
      thread_id: { type: 'string', description: 'Thread ID for replies (optional)' },
      reply_to_message_id: {
        type: 'string',
        description: 'Message ID being replied to (optional)',
      },
    },
    required: ['to', 'subject'],
  },
  execute(args: Record<string, unknown>): string {
    try {
      // Validate required fields
      const to = args.to as Array<{ email: string; name?: string }>;
      const subject = args.subject as string;

      if (!to || !Array.isArray(to) || to.length === 0) {
        return JSON.stringify({ success: false, error: 'At least one recipient is required' });
      }

      if (!subject) {
        return JSON.stringify({ success: false, error: 'Subject is required' });
      }

      const bodyText = args.body_text as string;
      const bodyHtml = args.body_html as string;

      if (!bodyText && !bodyHtml) {
        return JSON.stringify({
          success: false,
          error: 'Either body_text or body_html is required',
        });
      }

      // Get user's email from state
      const s = getGmailSkillState();
      const fromEmail = s.config.userEmail || (s.profile ? s.profile.emailAddress : undefined);

      if (!fromEmail) {
        return JSON.stringify({
          success: false,
          error: 'User email not available. Please ensure Gmail profile is loaded.',
        });
      }

      // Build email message
      const boundary = `----gmail_boundary_${Date.now()}_${Math.random().toString(36)}`;
      let rawMessage = '';

      // Helper to strip CR/LF from header values to prevent header injection
      const sanitizeHeader = (val: string): string => val.replace(/[\r\n]/g, '');

      // Headers
      rawMessage += `From: ${sanitizeHeader(fromEmail)}\r\n`;
      rawMessage += `To: ${sanitizeHeader(formatEmailAddresses(to))}\r\n`;

      if (args.cc && Array.isArray(args.cc) && (args.cc as any[]).length > 0) {
        rawMessage += `Cc: ${sanitizeHeader(formatEmailAddresses(args.cc as Array<{ email: string; name?: string }>))}\r\n`;
      }

      if (args.bcc && Array.isArray(args.bcc) && (args.bcc as any[]).length > 0) {
        rawMessage += `Bcc: ${sanitizeHeader(formatEmailAddresses(args.bcc as Array<{ email: string; name?: string }>))}\r\n`;
      }

      rawMessage += `Subject: ${sanitizeHeader(subject)}\r\n`;

      // Threading headers
      if (args.reply_to_message_id) {
        rawMessage += `In-Reply-To: <${args.reply_to_message_id}>\r\n`;
        rawMessage += `References: <${args.reply_to_message_id}>\r\n`;
      }

      rawMessage += `MIME-Version: 1.0\r\n`;

      const attachments =
        (args.attachments as Array<{ filename: string; data: string; mime_type: string }>) || [];

      if (attachments.length > 0) {
        rawMessage += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
      } else {
        if (bodyHtml && bodyText) {
          rawMessage += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;
        } else if (bodyHtml) {
          rawMessage += `Content-Type: text/html; charset=utf-8\r\n\r\n`;
        } else {
          rawMessage += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
        }
      }

      // Body content
      if (attachments.length > 0 || (bodyHtml && bodyText)) {
        if (bodyText) {
          rawMessage += `--${boundary}\r\n`;
          rawMessage += `Content-Type: text/plain; charset=utf-8\r\n\r\n`;
          rawMessage += `${bodyText}\r\n\r\n`;
        }

        if (bodyHtml) {
          rawMessage += `--${boundary}\r\n`;
          rawMessage += `Content-Type: text/html; charset=utf-8\r\n\r\n`;
          rawMessage += `${bodyHtml}\r\n\r\n`;
        }

        // Add attachments
        attachments.forEach(attachment => {
          rawMessage += `--${boundary}\r\n`;
          rawMessage += `Content-Type: ${attachment.mime_type}\r\n`;
          rawMessage += `Content-Disposition: attachment; filename="${attachment.filename}"\r\n`;
          rawMessage += `Content-Transfer-Encoding: base64\r\n\r\n`;
          rawMessage += `${attachment.data}\r\n\r\n`;
        });

        rawMessage += `--${boundary}--\r\n`;
      } else {
        rawMessage += `${bodyText || bodyHtml}\r\n`;
      }

      // Encode message for Gmail API (using btoa for base64 encoding)
      const encodedMessage = btoa(rawMessage)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      // Prepare API request body
      const requestBody: any = { raw: encodedMessage };

      if (args.thread_id) {
        requestBody.threadId = args.thread_id;
      }

      // Send email
      const response = gmailFetch<GmailMessage>('/users/me/messages/send', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });

      if (!response.success) {
        return JSON.stringify({
          success: false,
          error: (response.error ? response.error.message : null) || 'Failed to send email',
        });
      }

      const sentMessage = response.data as GmailMessage | undefined;

      // Update local database if email was sent successfully
      if (sentMessage && sentMessage.id) {
        const getEmailResponse = gmailFetch(`/users/me/messages/${sentMessage.id}`);
        if (getEmailResponse.success && getEmailResponse.data) {
          upsertEmail(getEmailResponse.data as GmailMessage);
        }
      }

      return JSON.stringify({
        success: true,
        message_id: sentMessage ? sentMessage.id : null,
        thread_id: sentMessage ? sentMessage.threadId : null,
        label_ids: sentMessage ? sentMessage.labelIds || [] : [],
        to: formatEmailAddresses(to),
        subject,
        size_estimate: (sentMessage ? sentMessage.sizeEstimate : 0) || 0,
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
 * Helper: Format email addresses for headers
 */
function formatEmailAddresses(addresses: Array<{ email: string; name?: string }>): string {
  return addresses
    .map(addr => {
      if (addr.name) {
        return `"${addr.name}" <${addr.email}>`;
      }
      return addr.email;
    })
    .join(', ');
}
