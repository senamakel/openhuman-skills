// Database helper functions for Gmail skill
// CRUD operations for emails, threads, labels, and attachments
// All queries are scoped by credential_id from the active integration.
import { convert } from 'html-to-text';

import { getGmailSkillState } from '../state';
import type {
  DatabaseAttachment,
  DatabaseEmail,
  DatabaseLabel,
  DatabaseThread,
  EmailSearchOptions,
  GmailLabel,
  GmailMessage,
  GmailThread,
} from '../types';

/** Get headers from Gmail API message (top-level payload or first part for multipart). */
function getMessageHeaders(message: GmailMessage): Array<{ name: string; value: string }> | null {
  const p = message ? message.payload : null;
  if (!p) return null;
  if (Array.isArray(p.headers) && p.headers.length > 0) return p.headers;
  const firstPart = Array.isArray(p.parts) ? p.parts[0] : null;
  if (firstPart && Array.isArray(firstPart.headers) && firstPart.headers.length > 0) {
    return firstPart.headers;
  }
  return null;
}

/** Current credential ID from skill state (for DB scoping). */
function credId(): string {
  return getGmailSkillState().config.credentialId;
}

/**
 * Insert or update an email in the database.
 * Detects sensitive content (passwords, API keys, etc.) and flags it.
 * When `redactSensitive` is true, body text/html are replaced with a
 * placeholder so credentials are never persisted locally.
 */
export function upsertEmail(message: GmailMessage, redactSensitive = false): void {
  const cid = credId();
  const now = Date.now();
  const headers = getMessageHeaders(message);
  if (!headers) {
    console.warn('[gmail] upsertEmail: no headers found (payload or first part)', {
      id: message ? message.id : null,
      hasPayload: !!(message ? message.payload : null),
    });
    return;
  }

  const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');
  const subject = subjectHeader ? subjectHeader.value : '';
  const fromHeader = headers.find(h => h.name.toLowerCase() === 'from');
  const from = fromHeader ? fromHeader.value : '';
  const toHeader = headers.find(h => h.name.toLowerCase() === 'to');
  const to = toHeader ? toHeader.value : '';
  const ccHeader = headers.find(h => h.name.toLowerCase() === 'cc');
  const cc = ccHeader ? ccHeader.value : null;
  const bccHeader = headers.find(h => h.name.toLowerCase() === 'bcc');
  const bcc = bccHeader ? bccHeader.value : null;
  const dateHeaderObj = headers.find(h => h.name.toLowerCase() === 'date');
  const dateHeader = dateHeaderObj ? dateHeaderObj.value : undefined;

  // Parse sender email and name from "Name <email>" format
  const fromMatch = from.match(/(.+?)\s*<([^>]+)>/) || [null, from, from];
  const senderNameRaw = fromMatch[1] ? fromMatch[1].trim().replace(/^["']|["']$/g, '') : null;
  const senderName = senderNameRaw !== null && senderNameRaw !== undefined ? senderNameRaw : null;
  const senderEmail = (fromMatch[2] ? fromMatch[2].trim() : '') || from;

  const internalDate =
    message.internalDate !== null && message.internalDate !== undefined
      ? message.internalDate
      : '0';
  const date = dateHeader ? new Date(dateHeader).getTime() : parseInt(internalDate, 10);
  const labelIds = Array.isArray(message.labelIds) ? message.labelIds : [];
  const isRead = !labelIds.includes('UNREAD');
  const isImportant = labelIds.includes('IMPORTANT');
  const isStarred = labelIds.includes('STARRED');
  const hasAttachments = hasEmailAttachments(message);

  // Extract body content — prefer plain text, fall back to converting HTML
  let bodyText = extractTextBody(message);
  let bodyHtml = extractHtmlBody(message);

  if (!bodyText && bodyHtml) {
    try {
      bodyText = convert(bodyHtml, {
        wordwrap: false,
        selectors: [
          { selector: 'img', format: 'skip' },
          { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
        ],
      });
    } catch {
      // Fall back to snippet if HTML conversion fails
      bodyText = message.snippet || null;
    }
  }

  // Check for sensitive information
  const sensitive =
    isSensitiveText(subject) || isSensitiveText(bodyText || '') || isSensitiveText(message.snippet);

  // Redact body if the email is sensitive and the user hasn't opted in
  if (sensitive && redactSensitive) {
    bodyText = '[Content redacted — contains sensitive information]';
    bodyHtml = null;
  }

  db.exec(
    `INSERT OR REPLACE INTO emails (
      credential_id, id, thread_id, subject, sender_email, sender_name, recipient_emails,
      cc_emails, bcc_emails, date, snippet, body_text, body_html,
      is_read, is_important, is_starred, has_attachments, is_sensitive, labels,
      size_estimate, history_id, internal_date, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cid,
      message.id || '',
      message.threadId || '',
      subject,
      senderEmail,
      senderName,
      to,
      cc,
      bcc,
      Number.isFinite(date) ? date : 0,
      message.snippet || '',
      bodyText !== null && bodyText !== undefined ? bodyText : null,
      bodyHtml !== null && bodyHtml !== undefined ? bodyHtml : null,
      isRead ? 1 : 0,
      isImportant ? 1 : 0,
      isStarred ? 1 : 0,
      hasAttachments ? 1 : 0,
      sensitive ? 1 : 0,
      JSON.stringify(labelIds),
      typeof message.sizeEstimate === 'number' ? message.sizeEstimate : 0,
      message.historyId || '',
      internalDate,
      now,
    ]
  );

  // Insert attachments if any
  if (hasAttachments) {
    insertEmailAttachments(message);
  }
}

/**
 * Insert or update a thread in the database
 */
export function upsertThread(thread: GmailThread): void {
  const cid = credId();
  const now = Date.now();
  const firstMessage = thread.messages[0];
  const lastMessage = thread.messages[thread.messages.length - 1];

  if (!firstMessage || !lastMessage) return;

  const subjectHdr = firstMessage.payload.headers.find(h => h.name.toLowerCase() === 'subject');
  const subject = subjectHdr ? subjectHdr.value : '';
  const participants = new Set<string>();

  // Collect all participants from all messages
  thread.messages.forEach(msg => {
    const headers = msg.payload.headers;
    const fromHdr = headers.find(h => h.name.toLowerCase() === 'from');
    const from = fromHdr ? fromHdr.value : undefined;
    const toHdr = headers.find(h => h.name.toLowerCase() === 'to');
    const to = toHdr ? toHdr.value : undefined;
    const ccHdr = headers.find(h => h.name.toLowerCase() === 'cc');
    const cc = ccHdr ? ccHdr.value : undefined;

    if (from) participants.add(extractEmail(from));
    if (to) to.split(',').forEach(email => participants.add(extractEmail(email.trim())));
    if (cc) cc.split(',').forEach(email => participants.add(extractEmail(email.trim())));
  });

  const lastMessageDate = parseInt(lastMessage.internalDate, 10);
  const allLabels = new Set<string>();
  let hasAttachments = false;
  let allRead = true;

  thread.messages.forEach(msg => {
    msg.labelIds.forEach(label => allLabels.add(label));
    if (hasEmailAttachments(msg)) hasAttachments = true;
    if (msg.labelIds.includes('UNREAD')) allRead = false;
  });

  db.exec(
    `INSERT OR REPLACE INTO threads (
      credential_id, id, subject, snippet, message_count, participants, last_message_date,
      is_read, has_attachments, labels, history_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cid,
      thread.id,
      subject,
      thread.snippet,
      thread.messages.length,
      Array.from(participants).join(', '),
      lastMessageDate,
      allRead ? 1 : 0,
      hasAttachments ? 1 : 0,
      JSON.stringify(Array.from(allLabels)),
      thread.historyId,
      now,
    ]
  );
}

/**
 * Insert or update a label in the database
 */
export function upsertLabel(label: GmailLabel): void {
  const cid = credId();
  const now = Date.now();

  db.exec(
    `INSERT OR REPLACE INTO labels (
      credential_id, id, name, type, message_list_visibility, label_list_visibility,
      messages_total, messages_unread, threads_total, threads_unread,
      color_text, color_background, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cid,
      label.id,
      label.name,
      label.type,
      label.messageListVisibility,
      label.labelListVisibility,
      label.messagesTotal || 0,
      label.messagesUnread || 0,
      label.threadsTotal || 0,
      label.threadsUnread || 0,
      (label.color && label.color.textColor) || null,
      (label.color && label.color.backgroundColor) || null,
      now,
    ]
  );
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get emails with optional filtering
 */
export function getEmails(options: EmailSearchOptions = {}): DatabaseEmail[] {
  const cid = credId();
  let sql = 'SELECT * FROM emails WHERE credential_id = ?';
  const params: unknown[] = [cid];

  if (options.query) {
    sql += ' AND (subject LIKE ? OR sender_email LIKE ? OR snippet LIKE ?)';
    const searchTerm = `%${options.query}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  if (options.labelIds && options.labelIds.length > 0) {
    const labelConditions = options.labelIds.map(() => 'labels LIKE ?').join(' OR ');
    sql += ` AND (${labelConditions})`;
    options.labelIds.forEach(labelId => {
      params.push(`%"${labelId}"%`);
    });
  }

  sql += ' ORDER BY date DESC';

  if (options.maxResults) {
    sql += ' LIMIT ?';
    params.push(options.maxResults);
  }

  return db.all(sql, params) as unknown as DatabaseEmail[];
}

/**
 * Get threads with optional filtering
 */
export function getThreads(options: EmailSearchOptions = {}): DatabaseThread[] {
  const cid = credId();
  let sql = 'SELECT * FROM threads WHERE credential_id = ?';
  const params: unknown[] = [cid];

  if (options.query) {
    sql += ' AND (subject LIKE ? OR participants LIKE ? OR snippet LIKE ?)';
    const searchTerm = `%${options.query}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  if (options.labelIds && options.labelIds.length > 0) {
    const labelConditions = options.labelIds.map(() => 'labels LIKE ?').join(' OR ');
    sql += ` AND (${labelConditions})`;
    options.labelIds.forEach(labelId => {
      params.push(`%"${labelId}"%`);
    });
  }

  sql += ' ORDER BY last_message_date DESC';

  if (options.maxResults) {
    sql += ' LIMIT ?';
    params.push(options.maxResults);
  }

  return db.all(sql, params) as unknown as DatabaseThread[];
}

/**
 * Get all labels
 */
export function getLabels(): DatabaseLabel[] {
  const cid = credId();
  return db.all('SELECT * FROM labels WHERE credential_id = ? ORDER BY type, name', [
    cid,
  ]) as unknown as DatabaseLabel[];
}

/**
 * Get email by ID
 */
export function getEmailCount(): number {
  const cid = credId();
  const row = db.get('SELECT COUNT(*) as count FROM emails WHERE credential_id = ?', [cid]) as {
    count: number;
  } | null;
  return row && row.count !== null && row.count !== undefined ? row.count : 0;
}

/** Returns true if an email with the given ID exists in the local DB (no row data fetched). */
export function emailExists(id: string): boolean {
  const cid = credId();
  return (
    db.get('SELECT 1 FROM emails WHERE credential_id = ? AND id = ? LIMIT 1', [cid, id]) !== null
  );
}

export function getEmailById(id: string): DatabaseEmail | null {
  const cid = credId();
  return db.get('SELECT * FROM emails WHERE credential_id = ? AND id = ?', [
    cid,
    id,
  ]) as DatabaseEmail | null;
}

/**
 * Get thread by ID
 */
export function getThreadById(id: string): DatabaseThread | null {
  const cid = credId();
  return db.get('SELECT * FROM threads WHERE credential_id = ? AND id = ?', [
    cid,
    id,
  ]) as DatabaseThread | null;
}

/**
 * Get attachments for an email
 */
export function getEmailAttachments(messageId: string): DatabaseAttachment[] {
  const cid = credId();
  return db.all('SELECT * FROM attachments WHERE credential_id = ? AND message_id = ?', [
    cid,
    messageId,
  ]) as unknown as DatabaseAttachment[];
}

/**
 * Update email read status
 */
export function updateEmailReadStatus(emailId: string, isRead: boolean): void {
  const cid = credId();
  db.exec('UPDATE emails SET is_read = ?, updated_at = ? WHERE credential_id = ? AND id = ?', [
    isRead ? 1 : 0,
    Date.now(),
    cid,
    emailId,
  ]);
}

/**
 * Get emails that have not yet been submitted to the backend.
 * Excludes sensitive emails — those are never sent to the backend.
 * Returns oldest-first so submissions are chronologically ordered.
 */
export function getUningestedEmails(limit = 500): DatabaseEmail[] {
  const cid = credId();
  return db.all(
    'SELECT * FROM emails WHERE credential_id = ? AND ingested = 0 AND is_sensitive = 0 ORDER BY date ASC LIMIT ?',
    [cid, limit]
  ) as unknown as DatabaseEmail[];
}

/**
 * Mark all sensitive emails as submitted so they don't accumulate
 * in the un-submitted queue. They are never actually sent to the backend.
 */
export function markSensitiveAsIngested(): void {
  const cid = credId();
  db.exec(
    'UPDATE emails SET ingested = 1 WHERE credential_id = ? AND is_sensitive = 1 AND ingested = 0',
    [cid]
  );
}

/**
 * Mark a batch of emails as submitted to the backend.
 */
export function markEmailsIngested(ids: string[]): void {
  if (ids.length === 0) return;
  const cid = credId();
  // SQLite has a variable limit, batch in groups of 99 (leaving 1 slot for credential_id)
  for (let i = 0; i < ids.length; i += 99) {
    const batch = ids.slice(i, i + 99);
    const placeholders = batch.map(() => '?').join(',');
    db.exec(`UPDATE emails SET ingested = 1 WHERE credential_id = ? AND id IN (${placeholders})`, [
      cid,
      ...batch,
    ]);
  }
}

// ---------------------------------------------------------------------------
// Sensitive text detection
// ---------------------------------------------------------------------------

/** Patterns that indicate an email contains sensitive credentials or secrets. */
const SENSITIVE_PATTERNS: RegExp[] = [
  // Explicit password disclosures
  /(?:password|passwd|pwd)\s*[:=]\s*\S+/i,
  /your (?:new )?password (?:is|was|has been)\b/i,
  /temporary password/i,
  /one[- ]?time (?:password|passcode|code)\s*[:=]\s*\S+/i,

  // API keys, tokens, secrets (key=value patterns with long values)
  /(?:api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key|auth[_-]?token|bearer)\s*[:=]\s*\S{16,}/i,

  // Private keys / certificates
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  /-----BEGIN CERTIFICATE-----/,

  // AWS / cloud credentials
  /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/,
  /aws[_-]?secret[_-]?access[_-]?key\s*[:=]\s*\S+/i,

  // Credit card numbers (4 groups of 4 digits)
  /\b(?:\d{4}[- ]?){3}\d{4}\b/,

  // Social security numbers (US)
  /\b\d{3}-\d{2}-\d{4}\b/,

  // Seed phrases / recovery phrases (12+ common BIP-39 words in sequence)
  /(?:abandon|ability|able|about|above|absent|absorb|abstract|absurd|abuse|access|accident)\b(?:\s+\w+){11,}/i,

  // Generic "here are your credentials" patterns
  /(?:credentials|login details)\s*(?:are|below|attached)/i,
];

/**
 * Check if text contains sensitive information (passwords, API keys, etc.).
 * Uses pattern matching — not a guarantee, but catches common cases.
 */
export function isSensitiveText(text: string): boolean {
  if (!text) return false;
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Helper: Extract email address from "Name <email>" format
 */
function extractEmail(emailStr: string): string {
  const match = emailStr.match(/<([^>]+)>/);
  return match ? match[1] : emailStr.trim();
}

/**
 * Helper: Check if email has attachments (recursively searches nested parts)
 */
function hasEmailAttachments(message: GmailMessage): boolean {
  const p = message ? message.payload : null;
  if (!p) return false;
  if (p.body && p.body.attachmentId) return true;
  if (Array.isArray(p.parts)) {
    return p.parts.some(
      part => (part.body && part.body.attachmentId) || (part.filename && part.filename.length > 0)
    );
  }
  return checkPart(p);
}

/** Recursively check a MIME part (or payload) for attachments. */
function checkPart(part: GmailMessage['payload']): boolean {
  if (!part) return false;
  if (part.body && part.body.attachmentId) return true;
  if (part.filename && part.filename.length > 0) return true;
  if (Array.isArray(part.parts)) return part.parts.some(p => checkPart(p));
  return false;
}

/**
 * Recursively search MIME parts for a part matching the given mimeType.
 * Gmail messages can have arbitrarily nested multipart/* structures, e.g.:
 *   multipart/mixed → multipart/alternative → text/plain | text/html
 */
// function _findPartByMimeType(
//   part: GmailMessage['payload'],
//   mimeType: string
// ): GmailMessage['payload'] | null {
//   if (part.mimeType === mimeType && part.body.data) {
//     return part;
//   }
//   if (part.parts) {
//     for (const child of part.parts) {
//       const found = _findPartByMimeType(child, mimeType);
//       if (found) return found;
//     }
//   }
//   return null;
// }

/**
 * Helper: Extract text body from message (recursively searches nested parts)
 */
function extractTextBody(message: GmailMessage): string | null {
  const p = message ? message.payload : null;
  if (!p) return null;
  if (p.mimeType === 'text/plain' && p.body && p.body.data) {
    try {
      return atob(p.body.data);
    } catch {
      return null;
    }
  }
  if (Array.isArray(p.parts)) {
    for (const part of p.parts) {
      if (part.mimeType === 'text/plain' && part.body && part.body.data) {
        try {
          return atob(part.body.data);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Helper: Extract HTML body from message (recursively searches nested parts)
 */
function extractHtmlBody(message: GmailMessage): string | null {
  const p = message ? message.payload : null;
  if (!p) return null;
  if (p.mimeType === 'text/html' && p.body && p.body.data) {
    try {
      return atob(p.body.data);
    } catch {
      return null;
    }
  }
  if (Array.isArray(p.parts)) {
    for (const part of p.parts) {
      if (part.mimeType === 'text/html' && part.body && part.body.data) {
        try {
          return atob(part.body.data);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Helper: Insert email attachments (recursively collects from nested parts)
 */
function insertEmailAttachments(message: GmailMessage): void {
  const cid = credId();
  const p = message ? message.payload : null;
  if (!p) return;
  const attachments: Array<{
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
    partId: string;
  }> = [];

  // Check main body
  if (p.body && p.body.attachmentId && p.filename) {
    attachments.push({
      attachmentId: p.body.attachmentId,
      filename: p.filename,
      mimeType: p.mimeType || '',
      size: p.body.size !== null && p.body.size !== undefined ? p.body.size : 0,
      partId: p.partId || '',
    });
  }

  // Check parts
  if (Array.isArray(p.parts)) {
    p.parts.forEach(part => {
      if (part.body && part.body.attachmentId && part.filename) {
        attachments.push({
          attachmentId: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || '',
          size: part.body.size !== null && part.body.size !== undefined ? part.body.size : 0,
          partId: part.partId || '',
        });
      }
    });
  }

  // Insert attachments
  attachments.forEach(att => {
    db.exec(
      `INSERT OR REPLACE INTO attachments
       (credential_id, message_id, attachment_id, filename, mime_type, size, part_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cid, message.id, att.attachmentId, att.filename, att.mimeType, att.size, att.partId]
    );
  });
}
