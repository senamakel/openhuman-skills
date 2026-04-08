// Gmail skill type definitions

export interface SkillConfig {
  credentialId: string;
  userEmail: string;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  maxEmailsPerSync: number;
  notifyOnNewEmails: boolean;
  /** Set by tests / OAuth flow */
  isAuthenticated?: boolean;
  /** Set by tests / OAuth flow */
  clientId?: string;
  showSensitiveMessages?: boolean;
}

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

/** A single MIME part. Parts can nest recursively for multipart/* messages. */
export interface GmailMessagePart {
  partId: string;
  mimeType: string;
  filename: string;
  headers: Array<{ name: string; value: string }>;
  body: { attachmentId?: string; size: number; data?: string };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: GmailMessagePart;
  sizeEstimate: number;
  historyId: string;
  internalDate: string;
}

export interface GmailThread {
  id: string;
  snippet: string;
  historyId: string;
  messages: GmailMessage[];
}

export interface GmailLabel {
  id: string;
  name: string;
  messageListVisibility: string;
  labelListVisibility: string;
  type: 'system' | 'user';
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
  color?: { textColor: string; backgroundColor: string };
}

export interface GmailAttachment {
  attachmentId: string;
  size: number;
  data: string;
}

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface SendEmailRequest {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  attachments?: Array<{ filename: string; data: string; mimeType: string }>;
  threadId?: string;
  replyToMessageId?: string;
}

export interface EmailSearchOptions {
  query?: string;
  labelIds?: string[];
  maxResults?: number;
  pageToken?: string;
  includeSpamTrash?: boolean;
}

export interface ThreadSearchOptions {
  query?: string;
  labelIds?: string[];
  maxResults?: number;
  pageToken?: string;
  includeSpamTrash?: boolean;
}

export interface DatabaseEmail {
  id: string;
  thread_id: string;
  subject: string;
  sender_email: string;
  sender_name: string | null;
  recipient_emails: string;
  cc_emails: string | null;
  bcc_emails: string | null;
  date: number;
  snippet: string;
  body_text: string | null;
  body_html: string | null;
  is_read: number;
  is_important: number;
  is_starred: number;
  has_attachments: number;
  labels: string;
  size_estimate: number;
  is_sensitive: number;
  ingested: number;
  history_id: string;
  internal_date: string;
  created_at: number;
  updated_at: number;
}

export interface DatabaseThread {
  id: string;
  subject: string;
  snippet: string;
  message_count: number;
  participants: string;
  last_message_date: number;
  is_read: number;
  has_attachments: number;
  labels: string;
  history_id: string;
  created_at: number;
  updated_at: number;
}

export interface DatabaseLabel {
  id: string;
  name: string;
  type: string;
  message_list_visibility: string;
  label_list_visibility: string;
  messages_total: number;
  messages_unread: number;
  threads_total: number;
  threads_unread: number;
  color_text: string | null;
  color_background: string | null;
  created_at: number;
  updated_at: number;
}

export interface DatabaseAttachment {
  id: string;
  message_id: string;
  attachment_id: string;
  filename: string;
  mime_type: string;
  size: number;
  part_id: string;
  created_at: number;
}

export interface SyncStatus {
  lastSyncTime: number;
  lastHistoryId: string;
  totalEmails: number;
  newEmailsCount: number;
  syncInProgress: boolean;
  nextSyncTime: number;
  syncProgress: number;
  syncProgressMessage: string;
}

export interface ApiError {
  code: number;
  message: string;
  errors?: Array<{ domain: string; reason: string; message: string }>;
}

export interface GmailSkillState {
  config: SkillConfig;
  profile: GmailProfile | null;
  syncStatus: SyncStatus;
  activeSessions: string[];
  rateLimitRemaining: number;
  rateLimitReset: number;
  lastApiError: string | null;
}
