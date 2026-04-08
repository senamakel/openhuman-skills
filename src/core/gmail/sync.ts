// Gmail email sync: initial + incremental sync with 30-day window.
// Fetches messages via Gmail API and upserts into local SQLite database.
// Skips emails already in the local DB to avoid redundant API calls.
import { syncIntegrationMetadata } from '../../shared/integration-metadata';
import { gmailFetch, isGmailConnected } from './api';
import { loadGmailProfile } from './api/helpers';
import {
  emailExists,
  getEmailById,
  getEmailCount,
  getEmails,
  getUningestedEmails,
  markEmailsIngested,
  markSensitiveAsIngested,
  upsertEmail,
} from './db/helpers';
import { getGmailSkillState, publishSkillState } from './state';
import type { GmailMessage } from './types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Number of days to look back for emails. */
const SYNC_WINDOW_DAYS = 30;

/** Max emails to fetch per list API page (Gmail max is 500). */
const PAGE_SIZE = 100;

/** Max pages to fetch per sync (100 ids/page × 10 pages = 1000 emails). */
const MAX_PAGES = 10;

/** Hard cap on total emails to sync. */
const MAX_EMAILS = 1000;

/** Batch size for messages.get (Gmail batch API supports up to 100). */
const BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Progress callback: receives a human-readable message and a 0-100 percentage. */
type SyncProgressCallback = (message: string, progress: number) => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Emit sync progress to the frontend via state. */
function emitSyncProgress(message: string, progress: number): void {
  const s = getGmailSkillState();
  s.syncStatus.syncProgress = progress;
  s.syncStatus.syncProgressMessage = message;
  state.setPartial({ syncProgress: progress, syncProgressMessage: message });
}

function syncGmailMetadataToBackend(): void {
  const s = getGmailSkillState();
  if (!s.profile) return;

  const metadata = {
    email_address: s.profile.emailAddress,
    messages_total: s.profile.messagesTotal,
    threads_total: s.profile.threadsTotal,
    history_id: s.profile.historyId,
  };

  syncIntegrationMetadata({
    title: 'Gmail profile sync',
    content: JSON.stringify(metadata),
    sourceType: 'email',
    metadata,
  });
}

/** Format a timestamp (ms) or days-ago offset as YYYY/MM/DD for Gmail query syntax. */
function gmailDateStr(msOrDaysAgo: number, isDaysAgo = false): string {
  const ms = isDaysAgo ? Date.now() - msOrDaysAgo * 24 * 60 * 60 * 1000 : msOrDaysAgo;
  const d = new Date(ms);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Fetch a page of message IDs from the Gmail API.
 * Returns the message references and optional next page token.
 */
function fetchMessagePage(
  query: string,
  pageToken?: string
): { messages: Array<{ id: string; threadId: string }>; nextPageToken?: string } {
  const params = [`maxResults=${PAGE_SIZE}`, `q=${encodeURIComponent(query)}`];
  if (pageToken) params.push(`pageToken=${encodeURIComponent(pageToken)}`);

  const response = gmailFetch<{
    messages?: Array<{ id: string; threadId: string }>;
    nextPageToken?: string;
  }>(`/users/me/messages?${params.join('&')}`);

  if (!response.success || !response.data || !response.data.messages) {
    if (response.error) console.error(`[gmail-sync] List error: ${response.error.message}`);
    return { messages: [] };
  }

  return { messages: response.data.messages, nextPageToken: response.data.nextPageToken };
}

/**
 * Fetch multiple messages in a single HTTP request using Gmail's batch API.
 * Sends a multipart/mixed request to /batch/gmail/v1 with up to BATCH_SIZE
 * individual messages.get requests. Returns parsed message objects.
 *
 * Falls back to individual fetches if the batch API fails (e.g., via proxy).
 */
function batchFetchMessages(msgIds: string[]): GmailMessage[] {
  if (msgIds.length === 0) return [];

  const boundary = 'batch_gmail_sync_' + Date.now();
  const parts = msgIds.map((id, i) => {
    return (
      '--' +
      boundary +
      '\r\n' +
      'Content-Type: application/http\r\n' +
      'Content-ID: <item' +
      i +
      '>\r\n' +
      '\r\n' +
      'GET /gmail/v1/users/me/messages/' +
      id +
      '?format=full\r\n' +
      '\r\n'
    );
  });
  const body = parts.join('') + '--' + boundary + '--\r\n';

  const response = gmailFetch<string>('/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/mixed; boundary=' + boundary },
    body,
    timeout: 60,
    rawBatch: true,
  });

  if (!response.success || !response.data) {
    console.warn(
      '[gmail-sync] Batch API failed, falling back to individual fetches:',
      response.error ? response.error.message : 'unknown'
    );
    return fetchMessagesIndividually(msgIds);
  }

  const messages = parseBatchResponse(response.data as unknown as string);

  // If batch returned fewer messages than requested, fetch missing ones individually
  if (messages.length < msgIds.length) {
    const fetchedIds = new Set(messages.map(m => m.id));
    const missingIds = msgIds.filter(id => !fetchedIds.has(id));
    if (missingIds.length > 0) {
      console.log(
        '[gmail-sync] Batch missed ' + missingIds.length + ' messages, fetching individually'
      );
      const fallback = fetchMessagesIndividually(missingIds);
      for (const msg of fallback) messages.push(msg);
    }
  }

  return messages;
}

/** Fetch messages one by one (fallback when batch fails). */
function fetchMessagesIndividually(msgIds: string[]): GmailMessage[] {
  const messages: GmailMessage[] = [];
  for (const id of msgIds) {
    const resp = gmailFetch('/users/me/messages/' + id);
    if (resp.success && resp.data) {
      messages.push(resp.data as GmailMessage);
    }
  }
  return messages;
}

/**
 * Parse a multipart/mixed batch response into individual message objects.
 * Each part contains an HTTP response with a JSON body.
 */
function parseBatchResponse(raw: string): GmailMessage[] {
  const messages: GmailMessage[] = [];

  // Find the boundary from the response (first line is --boundary)
  const firstLine = raw.split('\r\n')[0] || raw.split('\n')[0] || '';
  const bnd = firstLine.trim();
  if (!bnd.startsWith('--')) return messages;

  const parts = raw.split(bnd);
  for (const part of parts) {
    if (part.trim() === '' || part.trim() === '--') continue;

    // Find the JSON body — the last { ... } block in each part
    const jsonMatch = part.match(/\{[\s\S]*\}/);
    if (!jsonMatch) continue;

    try {
      const msg = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      if (msg.error) {
        console.warn('[gmail-sync] Batch item error:', JSON.stringify(msg.error).slice(0, 100));
        continue;
      }
      if (msg.id) {
        messages.push(msg as unknown as GmailMessage);
      }
    } catch {
      // Skip unparseable parts
    }
  }

  return messages;
}

/**
 * Upsert a message and immediately ingest it into memory (pipeline approach).
 * Returns true if the message was new.
 */
function syncAndIngestMessage(msg: GmailMessage, redactSensitive: boolean): boolean {
  // Skip spam and trash
  const labelIds = Array.isArray(msg.labelIds) ? msg.labelIds : [];
  if (labelIds.includes('SPAM') || labelIds.includes('TRASH')) {
    return false;
  }

  // Skip if email is already in DB and already ingested
  const existing = getEmailById(msg.id);
  if (existing && existing.ingested === 1) {
    return false;
  }

  try {
    upsertEmail(msg, redactSensitive);
  } catch (e) {
    console.error('[gmail-sync] FAIL upsert ' + msg.id + ': ' + e);
    return false;
  }

  // Immediately ingest into memory
  const content = (msg.snippet || '').trim();
  // Extract subject from headers
  let subj = '';
  const payload = msg.payload as unknown as Record<string, unknown> | undefined;
  if (payload && Array.isArray(payload.headers)) {
    for (const h of payload.headers as Array<{ name: string; value: string }>) {
      if (h.name.toLowerCase() === 'subject') {
        subj = h.value;
        break;
      }
    }
  }

  // Extract body text for ingestion (snippet is usually enough for embedding)
  // Full body extraction happens via upsertEmail → DB, but for memory we use snippet
  if (content.length >= MIN_CONTENT_LENGTH) {
    try {
      memory.insert({
        title: subj || 'Email ' + msg.id,
        content,
        sourceType: 'email',
        documentId: (msg.internalDate || Date.now()) + '-gmail-email-' + msg.id,
        metadata: { source: 'gmail', type: 'email', emailId: msg.id, threadId: msg.threadId },
        createdAt: msg.internalDate ? parseInt(msg.internalDate as string, 10) / 1000 : undefined,
      });
      markEmailsIngested([msg.id]);
    } catch (e) {
      // Non-fatal — email is still in DB
      console.error('[gmail-sync] FAIL ingest ' + msg.id + ': ' + e);
    }
  } else {
    // Mark as submitted even if too short to ingest
    markEmailsIngested([msg.id]);
  }

  return true;
}

/**
 * Shared pagination loop used by both initial and incremental sync.
 * Pipeline approach: list IDs → batch fetch → upsert + ingest immediately.
 * Returns { newEmails, skipped }.
 */
function runSyncPages(
  query: string,
  maxPages: number,
  log?: SyncProgressCallback
): { newEmails: number; skipped: number } {
  let pageToken: string | undefined;
  let newEmails = 0;
  let skipped = 0;
  let page = 0;
  let totalFetched = 0;
  const s = getGmailSkillState();
  const redact = !s.config.showSensitiveMessages;

  do {
    page++;
    if (log) log('Fetching message IDs (page ' + page + ')...', Math.min(5 + page * 5, 40));

    const result = fetchMessagePage(query, pageToken);
    if (result.messages.length === 0) break;

    pageToken = result.nextPageToken;

    // Filter out messages we already have
    const newIds: string[] = [];
    for (const msgRef of result.messages) {
      if (emailExists(msgRef.id)) {
        skipped++;
      } else {
        newIds.push(msgRef.id);
      }
    }

    totalFetched += result.messages.length;
    if (log)
      log(
        'Page ' +
          page +
          ': ' +
          newIds.length +
          ' new, ' +
          skipped +
          ' skipped (total: ' +
          totalFetched +
          ')',
        Math.min(10 + page * 8, 70)
      );

    // Batch-fetch new messages in chunks, upsert + ingest each immediately
    for (let i = 0; i < newIds.length; i += BATCH_SIZE) {
      const chunk = newIds.slice(i, i + BATCH_SIZE);
      console.log('[gmail-sync] Batch fetching ' + chunk.length + ' messages...');

      const messages = batchFetchMessages(chunk);
      for (const msg of messages) {
        if (syncAndIngestMessage(msg, redact)) {
          s.syncStatus.totalEmails++;
          newEmails++;
        }
      }

      publishSkillState();
    }

    if (log)
      log(
        'Page ' + page + ' done: ' + newEmails + ' synced, ' + skipped + ' skipped',
        Math.min(40 + page * 6, 85)
      );

    // Hard cap
    if (totalFetched >= MAX_EMAILS) {
      console.log('[gmail-sync] Reached ' + MAX_EMAILS + ' email cap, stopping');
      break;
    }
  } while (pageToken && page < maxPages);

  return { newEmails, skipped };
}

// ---------------------------------------------------------------------------
// Initial Sync
// ---------------------------------------------------------------------------

/**
 * Perform initial sync: loads all emails from the last 30 days.
 * Paginates through results and skips emails already in the local database.
 * Called on first connect or when initial sync hasn't been completed.
 */
export function performInitialSync(onProgress?: SyncProgressCallback): void {
  const s = getGmailSkillState();

  if (!isGmailConnected()) {
    console.log('[gmail-sync] No credential, skipping initial sync');
    return;
  }

  if (s.syncStatus.syncInProgress) {
    console.log('[gmail-sync] Sync already in progress, skipping');
    return;
  }

  const log = (msg: string, pct: number) => {
    console.log(`[gmail-sync] [${pct}%] ${msg}`);
    emitSyncProgress(msg, pct);
    if (onProgress) onProgress(msg, pct);
  };

  s.syncStatus.syncInProgress = true;
  s.syncStatus.newEmailsCount = 0;
  s.syncStatus.totalEmails = getEmailCount();
  publishSkillState();

  try {
    const afterDate = gmailDateStr(SYNC_WINDOW_DAYS, true);
    log(`Starting initial sync (emails after ${afterDate})...`, 0);

    const { newEmails, skipped } = runSyncPages(
      `after:${afterDate} -in:spam -in:trash`,
      MAX_PAGES,
      log
    );

    const now = Date.now();
    state.set('initialSyncCompleted', true);
    state.set('lastSyncTime', now);

    s.syncStatus.lastSyncTime = now;
    s.syncStatus.newEmailsCount = newEmails;
    s.syncStatus.nextSyncTime = now + s.config.syncIntervalMinutes * 60 * 1000;

    log(`Initial sync complete: ${newEmails} new emails, ${skipped} skipped`, 100);

    // Ingest newly synced emails into knowledge graph
    ingestNewEmails();

    if (newEmails > 0 && s.config.notifyOnNewEmails) {
      platform.notify('Gmail Sync Complete', `Synchronized ${newEmails} new emails`);
    }
  } catch (error) {
    console.error(`[gmail-sync] Initial sync failed: ${error}`);
    s.lastApiError = error instanceof Error ? error.message : String(error);
    emitSyncProgress(`Sync failed: ${s.lastApiError}`, 0);
  } finally {
    s.syncStatus.syncInProgress = false;
    s.syncStatus.syncProgress = 0;
    s.syncStatus.syncProgressMessage = '';
    publishSkillState();
    // Publish email metadata (no body_text to avoid breaking JSON transport)
    const emails = getEmails().map(e => ({
      id: e.id,
      subject: e.subject,
      sender_email: e.sender_email,
      sender_name: e.sender_name,
      date: e.date,
      // snippet omitted — raw text can break JSON transport
      is_read: e.is_read,
      is_starred: e.is_starred,
      labels: e.labels,
    }));
    state.setPartial({ emails });
  }
}

// ---------------------------------------------------------------------------
// Incremental Sync
// ---------------------------------------------------------------------------

/**
 * Incremental sync: fetches only emails newer than the last sync time,
 * within the 30-day window. Falls back to initial sync if not yet completed.
 */
export function onSync(): void {
  const s = getGmailSkillState();

  if (!isGmailConnected() || s.syncStatus.syncInProgress) return;

  try {
    loadGmailProfile();
    syncGmailMetadataToBackend();
  } catch (error) {
    console.warn(`[gmail] Profile fetch failed, continuing sync: ${error}`);
  }

  publishSkillState();

  if (!isSyncCompleted()) {
    return performInitialSync();
  }

  s.syncStatus.syncInProgress = true;
  s.syncStatus.newEmailsCount = 0;
  s.syncStatus.totalEmails = getEmailCount();
  emitSyncProgress('Starting incremental sync...', 0);

  try {
    const lastSyncTime = getLastSyncTime();
    const thirtyDaysAgoMs = Date.now() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const effectiveMs = lastSyncTime ? Math.max(lastSyncTime, thirtyDaysAgoMs) : thirtyDaysAgoMs;
    const query = `after:${gmailDateStr(effectiveMs)} -in:spam -in:trash`;

    const { newEmails, skipped } = runSyncPages(query, MAX_PAGES);

    const now = Date.now();
    state.set('lastSyncTime', now);
    s.syncStatus.lastSyncTime = now;
    s.syncStatus.newEmailsCount = newEmails;
    s.syncStatus.nextSyncTime = now + s.config.syncIntervalMinutes * 60 * 1000;

    emitSyncProgress(`Sync complete: ${newEmails} new, ${skipped} skipped`, 100);
    console.log(`[gmail-sync] Incremental sync done: ${newEmails} new, ${skipped} skipped`);

    // Ingest newly synced emails into knowledge graph
    ingestNewEmails();

    if (newEmails > 0 && s.config.notifyOnNewEmails) {
      platform.notify('New Gmail Emails', `${newEmails} new emails synced`);
    }
  } catch (error) {
    console.error(`[gmail-sync] Incremental sync failed: ${error}`);
    s.lastApiError = error instanceof Error ? error.message : String(error);
    emitSyncProgress(`Sync failed: ${s.lastApiError}`, 0);
  } finally {
    s.syncStatus.syncInProgress = false;
    s.syncStatus.syncProgress = 0;
    s.syncStatus.syncProgressMessage = '';
    publishSkillState();
    syncGmailMetadataToBackend();
    // Publish email metadata (no body_text to avoid breaking JSON transport)
    const emails = getEmails().map(e => ({
      id: e.id,
      subject: e.subject,
      sender_email: e.sender_email,
      sender_name: e.sender_name,
      date: e.date,
      // snippet omitted — raw text can break JSON transport
      is_read: e.is_read,
      is_starred: e.is_starred,
      labels: e.labels,
    }));
    state.setPartial({ emails });
  }
}

// ---------------------------------------------------------------------------
// Ingest synced emails into knowledge graph via memory.insert()
// ---------------------------------------------------------------------------

/** Max emails to pull from DB per ingestion round. */
const INGEST_QUERY_LIMIT = 500;

/**
 * Minimum content length (in characters) required for ingestion.
 * Very short strings may tokenize to zero tokens and crash the ONNX/CoreML
 * embedding model (shape {0} is not supported). Skip anything shorter.
 */
const MIN_CONTENT_LENGTH = 50;

/**
 * Ingest un-ingested emails into the knowledge graph.
 * Each email is sent via memory.insert() which routes through the Rust
 * ingestion pipeline (upsert → GLiNER entity/relation extraction → graph).
 * Sensitive emails are marked as ingested so they're skipped.
 */
function ingestNewEmails(): void {
  // Mark sensitive emails so they never enter the ingestion queue
  markSensitiveAsIngested();

  const emails = getUningestedEmails(INGEST_QUERY_LIMIT);
  if (emails.length === 0) return;

  emitSyncProgress(`Ingesting ${emails.length} emails into knowledge graph...`, 92);

  const ingestedIds: string[] = [];
  let ingestedCount = 0;

  for (const email of emails) {
    const content = (email.body_text || email.snippet || '').trim();
    if (content.length < MIN_CONTENT_LENGTH) {
      ingestedIds.push(email.id);
      continue;
    }

    try {
      memory.insert({
        title: email.subject || `Email ${email.id}`,
        content,
        sourceType: 'email',
        documentId: `${email.date || Date.now()}-gmail-email-${email.id}`,
        metadata: {
          source: 'gmail',
          type: 'email',
          emailId: email.id,
          threadId: email.thread_id,
          senderEmail: email.sender_email,
          senderName: email.sender_name,
          recipientEmails: email.recipient_emails,
          isRead: email.is_read === 1,
          isImportant: email.is_important === 1,
          isStarred: email.is_starred === 1,
          hasAttachments: email.has_attachments === 1,
          labels: email.labels,
        },
        createdAt: email.date ? email.date / 1000 : undefined,
        updatedAt: email.updated_at ? email.updated_at / 1000 : undefined,
      });
      ingestedIds.push(email.id);
      ingestedCount++;
    } catch (e) {
      console.error(`[gmail] Failed to ingest email ${email.id}: ${e}`);
    }
  }

  if (ingestedIds.length > 0) markEmailsIngested(ingestedIds);

  if (ingestedCount > 0) {
    console.log(`[gmail] Ingested ${ingestedCount} email(s) into knowledge graph`);
  }
}

// ---------------------------------------------------------------------------
// Sync state helpers
// ---------------------------------------------------------------------------

/** Check if initial sync has been completed. */
export function isSyncCompleted(): boolean {
  return state.get('initialSyncCompleted') === true;
}

/** Get last sync timestamp (ms since epoch), or null if never synced. */
export function getLastSyncTime(): number | null {
  const value = state.get('lastSyncTime');
  return typeof value === 'number' ? value : null;
}
