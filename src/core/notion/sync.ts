// Notion sync engine
// Pipeline approach: discover → fetch blocks → ingest, one page at a time.
import { syncIntegrationMetadata } from '../../shared/integration-metadata';
import { notionApi } from './api/index';
import {
  getDatabaseById,
  getDatabaseRowById,
  getEntityCounts,
  getLocalPages,
  getLocalSummaries,
  getPageById,
  markPagesIngested,
  markRowsIngested,
  updatePageContent,
  upsertDatabase,
  upsertDatabaseRow,
  upsertPage,
  upsertUser,
} from './db/helpers';
import { fetchBlockTreeText, formatPageTitle, isNotionConnected } from './helpers';
import { getNotionSkillState } from './state';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Minimum content length (in characters) required for ingestion.
 * Very short strings may tokenize to zero tokens and crash the ONNX/CoreML
 * embedding model (shape {0} is not supported). Skip anything shorter.
 */
const MIN_CONTENT_LENGTH = 50;

// ---------------------------------------------------------------------------
// Progress helper
// ---------------------------------------------------------------------------

/** Update sync progress and publish to frontend state. */
function syncProgress(phase: string, progress: number, message: string): void {
  const s = getNotionSkillState();
  s.syncStatus.syncPhase = phase;
  s.syncStatus.syncProgress = Math.round(Math.min(100, Math.max(0, progress)));
  s.syncStatus.syncMessage = message;
  console.log(`[notion][sync] [${phase}] ${progress.toFixed(0)}% — ${message}`);
  publishSyncState();
}

// ---------------------------------------------------------------------------
// Main sync orchestrator
// ---------------------------------------------------------------------------

export function performSync(): void {
  const s = getNotionSkillState();

  if (s.syncStatus.syncInProgress) {
    console.log('[notion] Sync already in progress, skipping');
    return;
  }

  if (!isNotionConnected()) {
    console.log('[notion] No credential, skipping sync');
    return;
  }

  const startTime = Date.now();
  s.syncStatus.syncInProgress = true;
  s.syncStatus.lastSyncError = null;
  syncProgress('starting', 0, 'Starting sync...');

  try {
    // Phase 1: Sync users (0-5%)
    syncProgress('users', 0, 'Fetching workspace users...');
    syncUsers();
    syncProgress('users', 5, 'Users synced');

    // Phase 2: Pipeline — discover pages/databases, fetch content, ingest (5-90%)
    syncProgress('sync', 5, 'Discovering and syncing pages...');
    syncPipeline();

    // Phase 3: Sync data_sources explicitly (90-95%)
    syncProgress('databases', 90, 'Syncing databases (data_sources)...');
    syncDataSources();

    // Snapshot for memory
    insertNotionMemorySnapshot();

    // Finalize
    const durationMs = Date.now() - startTime;
    const nowMs = Date.now();
    s.syncStatus.nextSyncTime = nowMs + s.config.syncIntervalMinutes * 60 * 1000;
    s.syncStatus.lastSyncDurationMs = durationMs;

    const counts = getEntityCounts();
    s.syncStatus.lastSyncTime = nowMs;

    s.syncStatus.totalPages = counts.pages;
    s.syncStatus.totalDatabases = counts.databases;
    s.syncStatus.pagesWithContent = counts.pagesWithContent;
    s.syncStatus.pagesWithSummary = counts.pagesWithSummary;
    s.syncStatus.summariesTotal = counts.summariesTotal;
    s.syncStatus.summariesPending = counts.summariesPending;
    s.syncStatus.totalDatabaseRows = counts.databaseRows;

    const secs = (durationMs / 1000).toFixed(1);
    syncProgress(
      'done',
      100,
      `Sync complete in ${secs}s — ${counts.pages} pages, ${counts.databases} dbs, ${counts.pagesWithContent} with content`
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    s.syncStatus.lastSyncError = errorMsg;
    s.syncStatus.lastSyncDurationMs = Date.now() - startTime;
    syncProgress('error', 0, `Sync failed: ${errorMsg}`);
  } finally {
    s.syncStatus.syncInProgress = false;
    s.syncStatus.syncPhase = null;
    s.syncStatus.syncProgress = 0;
    publishSyncState();
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Sync users
// ---------------------------------------------------------------------------

function syncUsers(): void {
  let startCursor: string | undefined;
  let hasMore = true;
  let count = 0;

  while (hasMore) {
    const result = notionApi.listUsers(100, startCursor);

    for (const user of result.results) {
      try {
        upsertUser(user as Record<string, unknown>);
        count++;
      } catch (e) {
        console.error(
          `[notion] Failed to upsert user ${(user as Record<string, unknown>).id}: ${e}`
        );
      }
    }

    hasMore = result.has_more;
    startCursor = (result.next_cursor as string | undefined) || undefined;
    syncProgress('users', Math.min(4, 1 + count), `Fetched ${count} users...`);
  }

  syncProgress('users', 5, `Synced ${count} users`);
}

// ---------------------------------------------------------------------------
// Phase 2: Pipeline — search → fetch blocks → ingest, per page
// ---------------------------------------------------------------------------

function syncPipeline(): void {
  const s = getNotionSkillState();
  const lastSyncTime = s.syncStatus.lastSyncTime;
  const isFirstSync = lastSyncTime === 0;
  const cutoffMs = Date.now() - THIRTY_DAYS_MS;
  const contentEnabled = s.config.contentSyncEnabled;

  let startCursor: string | undefined;
  let hasMore = true;
  let pageCount = 0;
  let pageSkipped = 0;
  let dbCount = 0;
  let contentSynced = 0;
  let ingested = 0;
  let errorCount = 0;
  let reachedOldItems = false;
  let batchNum = 0;

  while (hasMore && !reachedOldItems) {
    batchNum++;
    const body: Record<string, unknown> = {
      page_size: 100,
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
    };
    if (startCursor) body.start_cursor = startCursor;

    const result = notionApi.search(body);

    for (const item of result.results) {
      const rec = item as Record<string, unknown>;
      const lastEdited = rec.last_edited_time as string;
      if (!lastEdited) continue;

      const editedMs = new Date(lastEdited).getTime();

      // Stop when we reach items older than cutoff
      if (editedMs < cutoffMs) {
        reachedOldItems = true;
        break;
      }

      // Incremental: stop when we reach items older than last sync
      if (!isFirstSync && editedMs <= lastSyncTime) {
        reachedOldItems = true;
        break;
      }

      const objectType = rec.object as string;

      if (objectType === 'page') {
        // Check if page is unchanged
        const existing = getPageById(rec.id as string);
        if (
          existing &&
          existing.last_edited_time === lastEdited &&
          existing.ingested === 1 &&
          existing.content_text
        ) {
          pageSkipped++;
          continue;
        }

        // 1. Upsert page metadata
        const pageTitle = formatPageTitle(rec);
        try {
          upsertPage(rec);
          pageCount++;
        } catch (e) {
          console.error(`[notion][sync] FAIL upsert page "${pageTitle}" (${rec.id}): ${e}`);
          errorCount++;
          continue;
        }

        // 2. Fetch block content + ingest immediately
        if (contentEnabled) {
          const pageT0 = Date.now();
          try {
            const text = fetchBlockTreeText(rec.id as string, 2);
            updatePageContent(rec.id as string, text);
            contentSynced++;
            const trimmed = text.trim();
            const fetchMs = Date.now() - pageT0;

            if (trimmed.length >= MIN_CONTENT_LENGTH) {
              try {
                memory.insert({
                  title: pageTitle || `Notion page ${rec.id}`,
                  content: trimmed,
                  sourceType: 'doc',
                  documentId: `${rec.last_edited_time ? new Date(rec.last_edited_time as string).getTime() : Date.now()}-notion-page-${rec.id}`,
                  metadata: {
                    source: 'notion',
                    type: 'page',
                    pageId: rec.id,
                    url: rec.url,
                    parentType: rec.parent ? (rec.parent as Record<string, unknown>).type : null,
                    createdTime: rec.created_time,
                    lastEditedTime: rec.last_edited_time,
                  },
                  createdAt: rec.created_time
                    ? new Date(rec.created_time as string).getTime() / 1000
                    : undefined,
                  updatedAt: rec.last_edited_time
                    ? new Date(rec.last_edited_time as string).getTime() / 1000
                    : undefined,
                });
                markPagesIngested([rec.id as string]);
                ingested++;
                console.log(
                  `[notion][sync] ✓ page #${pageCount} "${pageTitle}" — ${trimmed.length}ch, ingested (${fetchMs}ms)`
                );
              } catch (e) {
                console.error(`[notion][sync] FAIL ingest page "${pageTitle}" (${rec.id}): ${e}`);
                markPagesIngested([rec.id as string]);
              }
            } else {
              markPagesIngested([rec.id as string]);
              console.log(
                `[notion][sync] ✓ page #${pageCount} "${pageTitle}" — ${trimmed.length}ch (too short, skipped ingest) (${fetchMs}ms)`
              );
            }
          } catch (e) {
            console.error(`[notion][sync] FAIL content page "${pageTitle}" (${rec.id}): ${e}`);
          }
        } else {
          console.log(`[notion][sync] ✓ page #${pageCount} "${pageTitle}" — metadata only`);
        }
      } else if (objectType === 'data_source' || objectType === 'database') {
        const existing = getDatabaseById ? getDatabaseById(rec.id as string) : null;
        if (existing && existing.last_edited_time === lastEdited) {
          continue;
        }
        try {
          upsertDatabase(rec);
          dbCount++;
        } catch (e) {
          console.error(`[notion] Failed to upsert database ${rec.id}: ${e}`);
          errorCount++;
        }
      }
    }

    hasMore = result.has_more;
    startCursor = (result.next_cursor as string | undefined) || undefined;

    // Update counts in state after every batch
    const batchCounts = getEntityCounts();
    s.syncStatus.totalPages = batchCounts.pages;
    s.syncStatus.totalDatabases = batchCounts.databases;
    s.syncStatus.pagesWithContent = batchCounts.pagesWithContent;

    // Progress: 5-90% range
    const pct = 5 + Math.min(85, (batchNum / 50) * 85);
    const total = pageCount + pageSkipped;
    syncProgress(
      'sync',
      pct,
      `batch ${batchNum}: ${total} pages (${pageCount} new, ${contentSynced} content, ${ingested} ingested), ${dbCount} dbs`
    );
  }

  state.set('last_search_sync', Date.now());

  const counts = getEntityCounts();
  s.syncStatus.totalPages = counts.pages;
  s.syncStatus.totalDatabases = counts.databases;
  s.syncStatus.pagesWithContent = counts.pagesWithContent;

  syncProgress(
    'sync',
    90,
    `Pipeline done: ${pageCount} pages synced, ${contentSynced} content fetched, ${ingested} ingested, ${dbCount} dbs` +
      (pageSkipped > 0 ? ` (${pageSkipped} unchanged)` : '') +
      (errorCount > 0 ? `, ${errorCount} errors` : '')
  );
}

// ---------------------------------------------------------------------------
// Phase 3: Sync data_sources explicitly
// ---------------------------------------------------------------------------

function syncDataSources(): void {
  const s = getNotionSkillState();
  const lastSyncTime = s.syncStatus.lastSyncTime;
  const isFirstSync = lastSyncTime === 0;
  const cutoffMs = Date.now() - THIRTY_DAYS_MS;

  let startCursor: string | undefined;
  let hasMore = true;
  let dbCount = 0;
  let skipped = 0;
  let rowCount = 0;
  let rowIngested = 0;
  let reachedOldItems = false;
  const syncedDbIds: string[] = [];

  // Step 1: Discover and upsert all data_sources
  while (hasMore && !reachedOldItems) {
    const searchBody: Record<string, unknown> = {
      page_size: 100,
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      filter: { property: 'object', value: 'data_source' },
    };
    if (startCursor) searchBody.start_cursor = startCursor;

    const result = notionApi.search(searchBody);

    for (const item of result.results) {
      const rec = item as Record<string, unknown>;
      const lastEdited = rec.last_edited_time as string;
      if (!lastEdited) continue;

      const editedMs = new Date(lastEdited).getTime();

      if (editedMs < cutoffMs) {
        reachedOldItems = true;
        break;
      }
      if (!isFirstSync && editedMs <= lastSyncTime) {
        reachedOldItems = true;
        break;
      }

      const existing = getDatabaseById ? getDatabaseById(rec.id as string) : null;
      if (existing && existing.last_edited_time === lastEdited) {
        skipped++;
      } else {
        try {
          upsertDatabase(rec);
          dbCount++;
          syncedDbIds.push(rec.id as string);
        } catch (e) {
          console.error(`[notion] Failed to upsert data_source ${rec.id}: ${e}`);
        }
      }
    }

    hasMore = result.has_more;
    startCursor = (result.next_cursor as string | undefined) || undefined;
    syncProgress('databases', 91, `Data sources: ${dbCount} synced, ${skipped} unchanged...`);
  }

  syncProgress(
    'databases',
    92,
    `Data sources: ${dbCount} synced${skipped > 0 ? `, ${skipped} unchanged` : ''}. Fetching rows...`
  );

  // Step 2: Query rows for each synced database and ingest
  for (let i = 0; i < syncedDbIds.length; i++) {
    const dbId = syncedDbIds[i];
    const dbInfo = getDatabaseById(dbId);
    const dbTitle = dbInfo ? dbInfo.title : dbId;
    let dbRowCount = 0;

    try {
      let rowCursor: string | undefined;
      let rowHasMore = true;

      while (rowHasMore) {
        const queryBody: Record<string, unknown> = { page_size: 100 };
        if (rowCursor) queryBody.start_cursor = rowCursor;

        const rowResult = notionApi.queryDataSource(dbId, queryBody);

        for (const row of rowResult.results) {
          const rowRec = row as Record<string, unknown>;
          const rowLastEdited = rowRec.last_edited_time as string;

          // Skip if row is unchanged and already ingested
          const existingRow = getDatabaseRowById(rowRec.id as string);
          if (
            existingRow &&
            existingRow.last_edited_time === rowLastEdited &&
            existingRow.ingested === 1
          ) {
            continue;
          }

          try {
            upsertDatabaseRow(rowRec, dbId);
            rowCount++;
            dbRowCount++;

            // Build text content from properties for ingestion
            const content = buildRowContent(rowRec).trim();
            const rowTitle = extractRowTitle(rowRec).trim();

            if (content.length >= MIN_CONTENT_LENGTH) {
              try {
                memory.insert({
                  title: rowTitle + ' (' + dbTitle + ')',
                  content,
                  sourceType: 'doc',
                  documentId:
                    (rowLastEdited ? new Date(rowLastEdited).getTime() : Date.now()) +
                    '-notion-dbrow-' +
                    (rowRec.id as string),
                  metadata: {
                    source: 'notion',
                    type: 'database_row',
                    databaseId: dbId,
                    databaseTitle: dbTitle,
                    rowId: rowRec.id,
                    url: rowRec.url,
                    createdTime: rowRec.created_time,
                    lastEditedTime: rowRec.last_edited_time,
                  },
                  createdAt: rowRec.created_time
                    ? new Date(rowRec.created_time as string).getTime() / 1000
                    : undefined,
                  updatedAt: rowRec.last_edited_time
                    ? new Date(rowRec.last_edited_time as string).getTime() / 1000
                    : undefined,
                });
                markRowsIngested([rowRec.id as string]);
                rowIngested++;
              } catch (e) {
                console.error(
                  `[notion][sync] FAIL ingest row "${rowTitle}" (${rowRec.id}) in db "${dbTitle}": ${e}`
                );
              }
            } else {
              // Mark as submitted even if too short to ingest
              markRowsIngested([rowRec.id as string]);
            }
          } catch (e) {
            console.error(`[notion][sync] FAIL upsert row ${rowRec.id} in db ${dbId}: ${e}`);
          }
        }

        rowHasMore = rowResult.has_more;
        rowCursor = (rowResult.next_cursor as string | undefined) || undefined;
      }

      console.log(
        `[notion][sync] \u2713 db "${dbTitle}" \u2014 ${dbRowCount} rows fetched, ${rowIngested} ingested`
      );
    } catch (e) {
      console.error(`[notion][sync] FAIL query db "${dbTitle}" (${dbId}): ${e}`);
    }

    const pct = 92 + Math.min(3, ((i + 1) / syncedDbIds.length) * 3);
    syncProgress('databases', pct, `DB ${i + 1}/${syncedDbIds.length}: ${rowCount} rows total`);
  }

  syncProgress(
    'databases',
    95,
    `Data sources done: ${dbCount} dbs, ${rowCount} rows (${rowIngested} ingested)${skipped > 0 ? `, ${skipped} unchanged` : ''}`
  );
}

// ---------------------------------------------------------------------------
// Row content helpers
// ---------------------------------------------------------------------------

/** Extract the title from a database row's properties. */
function extractRowTitle(rowRec: Record<string, unknown>): string {
  const props = rowRec.properties as Record<string, unknown> | undefined;
  if (props) {
    for (const key of Object.keys(props)) {
      const prop = props[key] as Record<string, unknown>;
      if (prop.type === 'title' && Array.isArray(prop.title)) {
        const texts = prop.title as Array<Record<string, unknown>>;
        const t = texts.map(rt => (rt.plain_text as string) || '').join('');
        if (t) return t;
      }
    }
  }
  return (rowRec.id as string) || '';
}

/** Build a text representation of a database row's properties for memory ingestion. */
function buildRowContent(rowRec: Record<string, unknown>): string {
  const props = rowRec.properties as Record<string, unknown> | undefined;
  if (!props) return '';

  const parts: string[] = [];
  for (const [key, propVal] of Object.entries(props)) {
    const prop = propVal as Record<string, unknown>;
    const propType = prop.type as string;

    if (propType === 'title' || propType === 'rich_text') {
      const arr = prop[propType];
      if (Array.isArray(arr)) {
        const t = arr
          .map((rt: Record<string, unknown>) => (rt.plain_text as string) || '')
          .join('');
        if (t) parts.push(key + ': ' + t);
      }
    } else if (propType === 'number' && prop.number != null) {
      parts.push(key + ': ' + prop.number);
    } else if (propType === 'select') {
      const sel = prop.select as Record<string, unknown> | null;
      if (sel && sel.name) parts.push(key + ': ' + (sel.name as string));
    } else if (propType === 'multi_select' && Array.isArray(prop.multi_select)) {
      const names = (prop.multi_select as Array<Record<string, unknown>>)
        .map(ms => ms.name as string)
        .filter(Boolean);
      if (names.length) parts.push(key + ': ' + names.join(', '));
    } else if (propType === 'date') {
      const dt = prop.date as Record<string, unknown> | null;
      if (dt && dt.start) parts.push(key + ': ' + (dt.start as string));
    } else if (propType === 'checkbox') {
      parts.push(key + ': ' + (prop.checkbox ? 'yes' : 'no'));
    } else if (propType === 'url' && prop.url) {
      parts.push(key + ': ' + (prop.url as string));
    } else if (propType === 'email' && prop.email) {
      parts.push(key + ': ' + (prop.email as string));
    } else if (propType === 'phone_number' && prop.phone_number) {
      parts.push(key + ': ' + (prop.phone_number as string));
    } else if (propType === 'status') {
      const st = prop.status as Record<string, unknown> | null;
      if (st && st.name) parts.push(key + ': ' + (st.name as string));
    } else if (propType === 'people' && Array.isArray(prop.people)) {
      const names = (prop.people as Array<Record<string, unknown>>)
        .map(p => (p.name as string) || '')
        .filter(Boolean);
      if (names.length) parts.push(key + ': ' + names.join(', '));
    }
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Memory snapshot
// ---------------------------------------------------------------------------

function insertNotionMemorySnapshot(): void {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const s = getNotionSkillState();
  const profile = (state.get('profile') as Record<string, unknown> | null) || null;
  if (!profile || !profile.id) return;

  const pages = getLocalPages({ limit: 100 }).map(p => ({
    id: p.id,
    title: p.title,
    url: p.url,
    icon: p.icon,
    parent_type: p.parent_type,
    parent_id: p.parent_id,
    created_by_id: p.created_by_id,
    last_edited_by_id: p.last_edited_by_id,
    created_time: p.created_time,
    last_edited_time: p.last_edited_time,
    content_synced_at: p.content_synced_at,
    archived: p.archived === 1,
    synced_at: p.synced_at,
    has_content: !!p.content_text,
    content_length: p.content_text ? p.content_text.length : 0,
    // content_text omitted — too large for metadata snapshot
  }));

  const summaries = getLocalSummaries(100).map(summary => ({
    id: summary.id,
    pageId: summary.page_id,
    url: summary.url,
    summary: summary.summary,
    category: summary.category,
    sentiment: summary.sentiment || 'neutral',
    entities: (() => {
      if (!summary.entities) return [];
      try {
        const parsed = JSON.parse(summary.entities) as unknown;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })(),
    topics: (() => {
      if (!summary.topics) return [];
      try {
        const parsed = JSON.parse(summary.topics) as unknown;
        return Array.isArray(parsed) ? (parsed as string[]) : [];
      } catch {
        return [];
      }
    })(),
    metadata: (() => {
      if (!summary.metadata) return {};
      try {
        const parsed = JSON.parse(summary.metadata) as unknown;
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    })(),
    sourceCreatedAt: summary.source_created_at,
    sourceUpdatedAt: summary.source_updated_at,
    createdAt: summary.created_at,
    synced: summary.synced === 1,
    syncedAt: summary.synced_at,
  }));

  const metadata = {
    snapshot_version: 'notion-sync-v2',
    captured_at: nowIso,
    id: profile.id,
    name: (profile.name as string | null) || null,
    email: (profile.email as string | null) || null,
    type: (profile.type as string | null) || null,
    avatar_url: (profile.avatar_url as string | null) || null,
    workspace_name: s.config.workspaceName || null,
    sync: {
      in_progress: s.syncStatus.syncInProgress,
      last_sync_time: s.syncStatus.lastSyncTime || null,
      next_sync_time: s.syncStatus.nextSyncTime || null,
      last_sync_duration_ms: s.syncStatus.lastSyncDurationMs || null,
      total_pages: s.syncStatus.totalPages,
      total_databases: s.syncStatus.totalDatabases,
      total_database_rows: s.syncStatus.totalDatabaseRows,
      pages_with_content: s.syncStatus.pagesWithContent,
      pages_with_summary: s.syncStatus.pagesWithSummary,
      summaries_total: s.syncStatus.summariesTotal,
      summaries_pending: s.syncStatus.summariesPending,
      last_sync_error: s.syncStatus.lastSyncError || null,
    },
    pages,
    pages_total: pages.length,
    summaries,
    summaries_total: summaries.length,
  };

  syncIntegrationMetadata({
    title: `Notion metadata sync — ${nowIso}`,
    content: JSON.stringify(metadata),
    sourceType: 'doc',
    metadata,
    createdAt: now / 1000,
    updatedAt: now / 1000,
  });
}

// ---------------------------------------------------------------------------
// State publishing helper
// ---------------------------------------------------------------------------

function publishSyncState(): void {
  const s = getNotionSkillState();
  const isConnected = isNotionConnected();

  state.setPartial({
    connection_status: isConnected ? 'connected' : 'disconnected',
    auth_status: isConnected ? 'authenticated' : 'not_authenticated',
    connection_error: s.syncStatus.lastSyncError || null,
    auth_error: null,
    is_initialized: isConnected,
    workspaceName: s.config.workspaceName || null,
    syncInProgress: s.syncStatus.syncInProgress,
    lastSyncTime: s.syncStatus.lastSyncTime
      ? new Date(s.syncStatus.lastSyncTime).toISOString()
      : null,
    nextSyncTime: s.syncStatus.nextSyncTime
      ? new Date(s.syncStatus.nextSyncTime).toISOString()
      : null,
    totalPages: s.syncStatus.totalPages,
    totalDatabases: s.syncStatus.totalDatabases,
    totalDatabaseRows: s.syncStatus.totalDatabaseRows,
    pagesWithContent: s.syncStatus.pagesWithContent,
    pagesWithSummary: s.syncStatus.pagesWithSummary,
    summariesTotal: s.syncStatus.summariesTotal,
    summariesPending: s.syncStatus.summariesPending,
    lastSyncError: s.syncStatus.lastSyncError,
    lastSyncDurationMs: s.syncStatus.lastSyncDurationMs,
    syncPhase: s.syncStatus.syncPhase,
    syncProgress: s.syncStatus.syncProgress,
    syncMessage: s.syncStatus.syncMessage,
  });
}
