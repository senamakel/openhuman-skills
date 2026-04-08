// Database helper functions for Notion skill
// CRUD operations for pages, databases, users, and sync state
// All queries are scoped by credential_id from the active integration.
import { getNotionSkillState } from '../state';

export interface LocalPage {
  id: string;
  credential_id: string;
  title: string;
  url: string | null;
  icon: string | null;
  parent_type: string;
  parent_id: string | null;
  created_by_id: string | null;
  last_edited_by_id: string | null;
  created_time: string;
  last_edited_time: string;
  archived: number;
  content_text: string | null;
  content_synced_at: number | null;
  page_entities: string | null;
  ingested: number;
  synced_at: number;
}

export interface LocalDatabaseRow {
  id: string;
  credential_id: string;
  database_id: string;
  title: string;
  url: string | null;
  icon: string | null;
  properties_json: string | null;
  properties_text: string | null;
  created_by_id: string | null;
  last_edited_by_id: string | null;
  created_time: string;
  last_edited_time: string;
  archived: number;
  ingested: number;
  synced_at: number;
}

export interface LocalDatabase {
  id: string;
  credential_id: string;
  title: string;
  description: string | null;
  url: string | null;
  icon: string | null;
  property_count: number;
  created_time: string;
  last_edited_time: string;
  archived: number;
  ingested: number;
  synced_at: number;
}

export interface LocalUser {
  id: string;
  credential_id: string;
  name: string;
  user_type: string;
  email: string | null;
  avatar_url: string | null;
  synced_at: number;
}

// ---------------------------------------------------------------------------
// Credential scoping
// ---------------------------------------------------------------------------

/** Return the active credential ID used to scope all DB rows. */
function credId(): string {
  return getNotionSkillState().config.credentialId;
}

// ---------------------------------------------------------------------------
// Helper: Extract icon string from Notion icon object
// ---------------------------------------------------------------------------

function extractIcon(icon: unknown): string | null {
  if (!icon) return null;
  const iconObj = icon as Record<string, unknown>;
  if (iconObj.type === 'emoji') return iconObj.emoji as string;
  if (iconObj.type === 'external') {
    const ext = iconObj.external as Record<string, string> | undefined;
    return (ext ? ext.url : null) || null;
  }
  if (iconObj.type === 'file') {
    const file = iconObj.file as Record<string, string> | undefined;
    return (file ? file.url : null) || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: Extract parent info from Notion parent object
// ---------------------------------------------------------------------------

function extractParent(parent: unknown): { type: string; id: string | null } {
  if (!parent) return { type: 'workspace', id: null };
  const p = parent as Record<string, unknown>;
  if (p.type === 'page_id') return { type: 'page_id', id: p.page_id as string };
  if (p.type === 'database_id') return { type: 'database_id', id: p.database_id as string };
  if (p.type === 'workspace') return { type: 'workspace', id: null };
  return { type: String(p.type || 'workspace'), id: null };
}

// ---------------------------------------------------------------------------
// Page operations
// ---------------------------------------------------------------------------

/**
 * Extract structured entities from Notion page properties and top-level fields.
 * Captures: created_by, last_edited_by, people properties (assignees),
 * relation properties (linked pages), created_by/last_edited_by property types.
 */
function extractPageEntities(
  page: Record<string, unknown>
): Array<{ id: string; type: string; name?: string; role: string; property?: string }> {
  const entities: Array<{
    id: string;
    type: string;
    name?: string;
    role: string;
    property?: string;
  }> = [];
  const seen = new Set<string>();

  const add = (
    id: string,
    type: string,
    name: string | undefined,
    role: string,
    property?: string
  ) => {
    const key = `${id}:${role}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push({ id, type, name: name || undefined, role, property });
  };

  // Top-level created_by / last_edited_by
  const createdBy = page.created_by as Record<string, unknown> | undefined;
  if (createdBy && createdBy.id) {
    add(createdBy.id as string, 'person', createdBy.name as string | undefined, 'creator');
  }
  const lastEditedBy = page.last_edited_by as Record<string, unknown> | undefined;
  if (lastEditedBy && lastEditedBy.id) {
    add(
      lastEditedBy.id as string,
      'person',
      lastEditedBy.name as string | undefined,
      'last_editor'
    );
  }

  // Scan properties for person, relation, created_by, last_edited_by types
  const props = page.properties as Record<string, unknown> | undefined;
  if (props) {
    for (const [propName, propVal] of Object.entries(props)) {
      const prop = propVal as Record<string, unknown>;
      const propType = prop.type as string;

      if (propType === 'people' && Array.isArray(prop.people)) {
        for (const person of prop.people as Array<Record<string, unknown>>) {
          if (person.id) {
            add(
              person.id as string,
              'person',
              person.name as string | undefined,
              'assignee',
              propName
            );
          }
        }
      } else if (propType === 'relation' && Array.isArray(prop.relation)) {
        for (const rel of prop.relation as Array<Record<string, unknown>>) {
          if (rel.id) {
            add(rel.id as string, 'page', undefined, 'linked', propName);
          }
        }
      } else if (propType === 'created_by' && prop.created_by) {
        const cb = prop.created_by as Record<string, unknown>;
        if (cb.id) {
          add(cb.id as string, 'person', cb.name as string | undefined, 'creator', propName);
        }
      } else if (propType === 'last_edited_by' && prop.last_edited_by) {
        const leb = prop.last_edited_by as Record<string, unknown>;
        if (leb.id) {
          add(leb.id as string, 'person', leb.name as string | undefined, 'last_editor', propName);
        }
      }
    }
  }

  return entities;
}

/**
 * Insert or update a page from a Notion API page object
 */
export function upsertPage(page: Record<string, unknown>): void {
  const cid = credId();
  const now = Date.now();

  // Extract title from properties
  let title = page.id as string;
  const props = page.properties as Record<string, unknown> | undefined;
  if (props) {
    for (const key of Object.keys(props)) {
      const prop = props[key] as Record<string, unknown>;
      if (prop.type === 'title' && Array.isArray(prop.title)) {
        const texts = prop.title as Array<Record<string, unknown>>;
        const t = texts.map(rt => (rt.plain_text as string) || '').join('');
        if (t) {
          title = t;
          break;
        }
      }
    }
  }

  const iconStr = extractIcon(page.icon);
  const parent = extractParent(page.parent);
  const createdBy = page.created_by as Record<string, unknown> | undefined;
  const lastEditedBy = page.last_edited_by as Record<string, unknown> | undefined;

  // Extract structured entities from properties (people, relations, etc.)
  const pageEntities = extractPageEntities(page);
  const pageEntitiesJson = pageEntities.length > 0 ? JSON.stringify(pageEntities) : null;

  db.exec(
    `INSERT INTO pages (
      id, credential_id, title, url, icon, parent_type, parent_id,
      created_by_id, last_edited_by_id,
      created_time, last_edited_time, archived, page_entities, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(credential_id, id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      icon = excluded.icon,
      parent_type = excluded.parent_type,
      parent_id = excluded.parent_id,
      created_by_id = excluded.created_by_id,
      last_edited_by_id = excluded.last_edited_by_id,
      created_time = excluded.created_time,
      last_edited_time = excluded.last_edited_time,
      archived = excluded.archived,
      page_entities = excluded.page_entities,
      ingested = 0,
      synced_at = excluded.synced_at`,
    [
      page.id as string,
      cid,
      title,
      (page.url as string) || null,
      iconStr,
      parent.type,
      parent.id,
      ((createdBy ? createdBy.id : null) as string) || null,
      ((lastEditedBy ? lastEditedBy.id : null) as string) || null,
      page.created_time as string,
      page.last_edited_time as string,
      (page.archived as boolean) ? 1 : 0,
      pageEntitiesJson,
      now,
    ]
  );
}

/**
 * Update a page's extracted content text and reset ingested
 * so the updated content gets re-submitted.
 */
export function updatePageContent(pageId: string, contentText: string): void {
  const cid = credId();
  db.exec(
    'UPDATE pages SET content_text = ?, content_synced_at = ?, ingested = 0 WHERE credential_id = ? AND id = ?',
    [contentText, Date.now(), cid, pageId]
  );
}

/**
 * Get a single page by ID
 */
export function getPageById(pageId: string): LocalPage | null {
  const cid = credId();
  return db.get('SELECT * FROM pages WHERE credential_id = ? AND id = ?', [
    cid,
    pageId,
  ]) as LocalPage | null;
}

/**
 * Query local pages with optional search and filtering
 */
export function getLocalPages(
  options: { query?: string; limit?: number; includeArchived?: boolean } = {}
): LocalPage[] {
  const cid = credId();
  let sql = 'SELECT * FROM pages WHERE credential_id = ?';
  const params: unknown[] = [cid];

  if (!options.includeArchived) {
    sql += ' AND archived = 0';
  }

  if (options.query) {
    sql += ' AND (title LIKE ? OR content_text LIKE ?)';
    const term = `%${options.query}%`;
    params.push(term, term);
  }

  sql += ' ORDER BY last_edited_time DESC';

  const limit = options.limit || 50;
  sql += ' LIMIT ?';
  params.push(limit);

  return db.all(sql, params) as unknown as LocalPage[];
}

/**
 * Get pages that need content syncing (content not yet fetched, or stale).
 * Uses last_edited_time: only returns pages where we never synced content, or
 * the page was edited after we last synced (last_edited_time > content_synced_at).
 * @param limit - Max number of pages to return
 * @param updatedAfterIso - Optional ISO string cutoff; only return pages with last_edited_time >= this (e.g. 30 days ago)
 */
export function getPagesNeedingContent(limit: number, updatedAfterIso?: string): LocalPage[] {
  const cid = credId();
  // last_edited_time is ISO string; content_synced_at is ms. Compare: need sync if
  // content_synced_at IS NULL or last_edited_time (as ms) > content_synced_at
  const lastEditedMsExpr = `(strftime('%s', substr(last_edited_time, 1, 10) || ' ' || substr(last_edited_time, 12, 8)) * 1000)`;
  let sql = `SELECT * FROM pages
     WHERE credential_id = ?
       AND archived = 0
       AND (content_synced_at IS NULL OR content_synced_at < ${lastEditedMsExpr})`;
  const params: unknown[] = [cid];

  if (updatedAfterIso) {
    sql += ' AND last_edited_time >= ?';
    params.push(updatedAfterIso);
  }

  sql += ' ORDER BY last_edited_time DESC LIMIT ?';
  params.push(limit);

  return db.all(sql, params) as unknown as LocalPage[];
}

/**
 * Get structured entities for a page, with user names resolved from the users table.
 * Returns the stored page_entities with names filled in from local user records.
 */
export function getPageStructuredEntities(
  pageId: string
): Array<{ id: string; type: string; name?: string; role: string; property?: string }> {
  const cid = credId();
  const page = db.get(
    'SELECT page_entities, created_by_id, last_edited_by_id FROM pages WHERE credential_id = ? AND id = ?',
    [cid, pageId]
  ) as {
    page_entities: string | null;
    created_by_id: string | null;
    last_edited_by_id: string | null;
  } | null;
  if (!page) return [];

  let entities: Array<{
    id: string;
    type: string;
    name?: string;
    role: string;
    property?: string;
  }> = [];
  if (page.page_entities) {
    try {
      entities = JSON.parse(page.page_entities);
    } catch {
      entities = [];
    }
  }

  // If no entities from properties, at least add created_by / last_edited_by
  const seen = new Set(entities.map(e => `${e.id}:${e.role}`));
  if (page.created_by_id && !seen.has(`${page.created_by_id}:creator`)) {
    entities.push({ id: page.created_by_id, type: 'person', role: 'creator' });
  }
  if (page.last_edited_by_id && !seen.has(`${page.last_edited_by_id}:last_editor`)) {
    entities.push({ id: page.last_edited_by_id, type: 'person', role: 'last_editor' });
  }

  // Resolve names from users table
  for (const entity of entities) {
    if (entity.type === 'person' && !entity.name) {
      const user = db.get('SELECT name FROM users WHERE credential_id = ? AND id = ?', [
        cid,
        entity.id,
      ]) as { name: string } | null;
      if (user) entity.name = user.name;
    }
  }

  return entities;
}

/**
 * Get pages that need AI summarization.
 * Returns pages where content_text exists and no summary record exists
 * in the summaries table yet.
 */
export function getPagesNeedingSummary(limit: number): LocalPage[] {
  const cid = credId();
  return db.all(
    `SELECT p.* FROM pages p
     LEFT JOIN summaries s ON s.credential_id = p.credential_id AND s.page_id = p.id
     WHERE p.credential_id = ?
       AND p.archived = 0
       AND p.content_text IS NOT NULL
       AND s.id IS NULL
     ORDER BY p.last_edited_time DESC
     LIMIT ?`,
    [cid, limit]
  ) as unknown as LocalPage[];
}

/**
 * Get database rows that need AI summarization.
 * Returns rows where properties_text exists and no summary record exists
 * in the summaries table yet (using the row ID as page_id).
 */
export function getRowsNeedingSummary(
  limit: number
): Array<{
  id: string;
  database_id: string;
  title: string;
  url: string | null;
  properties_text: string | null;
  created_time: string;
  last_edited_time: string;
  created_by_id: string | null;
  last_edited_by_id: string | null;
}> {
  const cid = credId();
  return db.all(
    `SELECT r.id, r.database_id, r.title, r.url, r.properties_text,
            r.created_time, r.last_edited_time, r.created_by_id, r.last_edited_by_id
     FROM database_rows r
     LEFT JOIN summaries s ON s.credential_id = r.credential_id AND s.page_id = r.id
     WHERE r.credential_id = ?
       AND r.archived = 0
       AND r.properties_text IS NOT NULL
       AND s.id IS NULL
     ORDER BY r.last_edited_time DESC
     LIMIT ?`,
    [cid, limit]
  ) as unknown as Array<{
    id: string;
    database_id: string;
    title: string;
    url: string | null;
    properties_text: string | null;
    created_time: string;
    last_edited_time: string;
    created_by_id: string | null;
    last_edited_by_id: string | null;
  }>;
}

/**
 * Get structured entities for a database row, with user names resolved from the users table.
 * Database rows have created_by_id and last_edited_by_id but also may have
 * people/relation properties in their properties_json.
 */
export function getRowStructuredEntities(
  rowId: string
): Array<{ id: string; type: string; name?: string; role: string; property?: string }> {
  const cid = credId();
  const row = db.get(
    'SELECT properties_json, created_by_id, last_edited_by_id FROM database_rows WHERE credential_id = ? AND id = ?',
    [cid, rowId]
  ) as {
    properties_json: string | null;
    created_by_id: string | null;
    last_edited_by_id: string | null;
  } | null;
  if (!row) return [];

  const entities: Array<{
    id: string;
    type: string;
    name?: string;
    role: string;
    property?: string;
  }> = [];
  const seen = new Set<string>();

  const add = (
    id: string,
    type: string,
    name: string | undefined,
    role: string,
    property?: string
  ) => {
    const key = `${id}:${role}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push({ id, type, name: name || undefined, role, property });
  };

  // Top-level created_by / last_edited_by
  if (row.created_by_id) {
    add(row.created_by_id, 'person', undefined, 'creator');
  }
  if (row.last_edited_by_id) {
    add(row.last_edited_by_id, 'person', undefined, 'last_editor');
  }

  // Scan properties for people, relations, etc.
  if (row.properties_json) {
    try {
      const props = JSON.parse(row.properties_json) as Record<string, unknown>;
      for (const [propName, propVal] of Object.entries(props)) {
        const prop = propVal as Record<string, unknown>;
        const propType = prop.type as string;

        if (propType === 'people' && Array.isArray(prop.people)) {
          for (const person of prop.people as Array<Record<string, unknown>>) {
            if (person.id) {
              add(
                person.id as string,
                'person',
                person.name as string | undefined,
                'assignee',
                propName
              );
            }
          }
        } else if (propType === 'relation' && Array.isArray(prop.relation)) {
          for (const rel of prop.relation as Array<Record<string, unknown>>) {
            if (rel.id) {
              add(rel.id as string, 'page', undefined, 'linked', propName);
            }
          }
        } else if (propType === 'created_by' && prop.created_by) {
          const cb = prop.created_by as Record<string, unknown>;
          if (cb.id) {
            add(cb.id as string, 'person', cb.name as string | undefined, 'creator', propName);
          }
        } else if (propType === 'last_edited_by' && prop.last_edited_by) {
          const leb = prop.last_edited_by as Record<string, unknown>;
          if (leb.id) {
            add(
              leb.id as string,
              'person',
              leb.name as string | undefined,
              'last_editor',
              propName
            );
          }
        }
      }
    } catch {
      // Invalid JSON, skip property extraction
    }
  }

  // Resolve names from users table
  for (const entity of entities) {
    if (entity.type === 'person' && !entity.name) {
      const user = db.get('SELECT name FROM users WHERE credential_id = ? AND id = ?', [
        cid,
        entity.id,
      ]) as { name: string } | null;
      if (user) entity.name = user.name;
    }
  }

  return entities;
}

// ---------------------------------------------------------------------------
// Summary operations
// ---------------------------------------------------------------------------

export interface LocalSummary {
  id: number;
  credential_id: string;
  page_id: string;
  url: string | null;
  summary: string;
  category: string | null;
  sentiment: string | null;
  entities: string | null;
  topics: string | null;
  metadata: string | null;
  source_created_at: string;
  source_updated_at: string;
  created_at: number;
  synced: number;
  synced_at: number | null;
}

/**
 * Insert a new summary record for a page.
 * Entities, topics, and metadata are stored as JSON strings.
 */
export function insertSummary(opts: {
  pageId: string;
  url?: string | null;
  summary: string;
  category?: string;
  sentiment?: string;
  entities?: unknown[];
  topics?: string[];
  metadata?: Record<string, unknown>;
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
}): void {
  const cid = credId();
  db.exec(
    `INSERT INTO summaries (
      credential_id, page_id, url, summary, category, sentiment, entities, topics, metadata,
      source_created_at, source_updated_at, created_at, synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      cid,
      opts.pageId,
      opts.url || null,
      opts.summary,
      opts.category || null,
      opts.sentiment || null,
      opts.entities ? JSON.stringify(opts.entities) : null,
      opts.topics ? JSON.stringify(opts.topics) : null,
      opts.metadata ? JSON.stringify(opts.metadata) : null,
      opts.sourceCreatedAt,
      opts.sourceUpdatedAt,
      Date.now(),
    ]
  );
}

/**
 * Get the most recent summaries (all, synced or not) for publishing to the frontend.
 */
export function getLocalSummaries(limit: number): LocalSummary[] {
  const cid = credId();
  return db.all(
    'SELECT * FROM summaries WHERE credential_id = ? ORDER BY created_at DESC LIMIT ?',
    [cid, limit]
  ) as unknown as LocalSummary[];
}

/**
 * Get all summaries that have not been synced to the server yet.
 */
export function getUnsyncedSummaries(limit: number): LocalSummary[] {
  const cid = credId();
  return db.all(
    'SELECT * FROM summaries WHERE credential_id = ? AND synced = 0 ORDER BY created_at ASC LIMIT ?',
    [cid, limit]
  ) as unknown as LocalSummary[];
}

/**
 * Mark a list of summary IDs as synced.
 */
export function markSummariesSynced(ids: number[]): void {
  if (ids.length === 0) return;
  const now = Date.now();
  const placeholders = ids.map(() => '?').join(',');
  db.exec(`UPDATE summaries SET synced = 1, synced_at = ? WHERE id IN (${placeholders})`, [
    now,
    ...ids,
  ]);
}

/**
 * Get count of synced vs unsynced summaries.
 */
export function getSummaryCounts(): { total: number; synced: number; pending: number } {
  const cid = credId();
  const total = db.get('SELECT COUNT(*) as cnt FROM summaries WHERE credential_id = ?', [cid]) as {
    cnt: number;
  } | null;
  const synced = db.get(
    'SELECT COUNT(*) as cnt FROM summaries WHERE credential_id = ? AND synced = 1',
    [cid]
  ) as { cnt: number } | null;
  return {
    total: (total ? total.cnt : 0) || 0,
    synced: (synced ? synced.cnt : 0) || 0,
    pending: ((total ? total.cnt : 0) || 0) - ((synced ? synced.cnt : 0) || 0),
  };
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

/**
 * Insert or update a database from a Notion API database object
 */
export function upsertDatabase(database: Record<string, unknown>): void {
  const cid = credId();
  const now = Date.now();

  // Extract title
  let title = '(Untitled)';
  if (Array.isArray(database.title)) {
    const texts = database.title as Array<Record<string, unknown>>;
    const t = texts.map(rt => (rt.plain_text as string) || '').join('');
    if (t) title = t;
  }

  // Extract description
  let description: string | null = null;
  if (Array.isArray(database.description)) {
    const texts = database.description as Array<Record<string, unknown>>;
    const d = texts.map(rt => (rt.plain_text as string) || '').join('');
    if (d) description = d;
  }

  const iconStr = extractIcon(database.icon);
  const propertyCount = Object.keys((database.properties as Record<string, unknown>) || {}).length;

  db.exec(
    `INSERT INTO databases (
      id, credential_id, title, description, url, icon, property_count,
      created_time, last_edited_time, archived, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(credential_id, id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      url = excluded.url,
      icon = excluded.icon,
      property_count = excluded.property_count,
      created_time = excluded.created_time,
      last_edited_time = excluded.last_edited_time,
      archived = excluded.archived,
      ingested = 0,
      synced_at = excluded.synced_at`,
    [
      database.id as string,
      cid,
      title,
      description,
      (database.url as string) || null,
      iconStr,
      propertyCount,
      database.created_time as string,
      database.last_edited_time as string,
      (database.archived as boolean) ? 1 : 0,
      now,
    ]
  );
}

/**
 * Get a single database by ID
 */
export function getDatabaseById(databaseId: string): LocalDatabase | null {
  const cid = credId();
  return db.get('SELECT * FROM databases WHERE credential_id = ? AND id = ?', [
    cid,
    databaseId,
  ]) as LocalDatabase | null;
}

/**
 * Query local databases with optional search
 */
export function getLocalDatabases(
  options: { query?: string; limit?: number } = {}
): LocalDatabase[] {
  const cid = credId();
  let sql = 'SELECT * FROM databases WHERE credential_id = ? AND archived = 0';
  const params: unknown[] = [cid];

  if (options.query) {
    sql += ' AND (title LIKE ? OR description LIKE ?)';
    const term = `%${options.query}%`;
    params.push(term, term);
  }

  sql += ' ORDER BY last_edited_time DESC';

  const limit = options.limit || 50;
  sql += ' LIMIT ?';
  params.push(limit);

  return db.all(sql, params) as unknown as LocalDatabase[];
}

// ---------------------------------------------------------------------------
// Database row operations
// ---------------------------------------------------------------------------

/**
 * Extract a flat text representation of all property values from a Notion page/row.
 * This is used for full-text search over database rows.
 */
function extractPropertiesText(properties: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const [, propVal] of Object.entries(properties)) {
    const prop = propVal as Record<string, unknown>;
    const propType = prop.type as string;

    switch (propType) {
      case 'title':
      case 'rich_text': {
        const texts = prop[propType] as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(texts)) {
          const t = texts.map(rt => (rt.plain_text as string) || '').join('');
          if (t) parts.push(t);
        }
        break;
      }
      case 'number': {
        const num = prop.number;
        if (num != null) parts.push(String(num));
        break;
      }
      case 'select': {
        const sel = prop.select as Record<string, unknown> | null;
        if (sel && sel.name) parts.push(sel.name as string);
        break;
      }
      case 'multi_select': {
        const ms = prop.multi_select as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(ms)) {
          for (const item of ms) {
            if (item.name) parts.push(item.name as string);
          }
        }
        break;
      }
      case 'status': {
        const st = prop.status as Record<string, unknown> | null;
        if (st && st.name) parts.push(st.name as string);
        break;
      }
      case 'date': {
        const dt = prop.date as Record<string, unknown> | null;
        if (dt && dt.start) parts.push(dt.start as string);
        if (dt && dt.end) parts.push(dt.end as string);
        break;
      }
      case 'email': {
        const email = prop.email as string | null;
        if (email) parts.push(email);
        break;
      }
      case 'phone_number': {
        const phone = prop.phone_number as string | null;
        if (phone) parts.push(phone);
        break;
      }
      case 'url': {
        const url = prop.url as string | null;
        if (url) parts.push(url);
        break;
      }
      case 'checkbox': {
        parts.push(prop.checkbox ? 'true' : 'false');
        break;
      }
      case 'people': {
        const people = prop.people as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(people)) {
          for (const person of people) {
            if (person.name) parts.push(person.name as string);
          }
        }
        break;
      }
      case 'formula': {
        const formula = prop.formula as Record<string, unknown> | null;
        if (formula) {
          const fType = formula.type as string;
          const val = formula[fType];
          if (val != null) parts.push(String(val));
        }
        break;
      }
      case 'rollup': {
        const rollup = prop.rollup as Record<string, unknown> | null;
        if (rollup) {
          const rType = rollup.type as string;
          const val = rollup[rType];
          if (val != null && !Array.isArray(val)) parts.push(String(val));
        }
        break;
      }
      // Skip: relation, created_by, last_edited_by, created_time, last_edited_time, files
      // These are either captured elsewhere or not useful as text
    }
  }

  return parts.join(' ');
}

/**
 * Insert or update a database row from a Notion API page object returned by queryDataSource.
 */
export function upsertDatabaseRow(row: Record<string, unknown>, databaseId: string): void {
  const cid = credId();
  const now = Date.now();

  // Extract title from properties
  let title = row.id as string;
  const props = row.properties as Record<string, unknown> | undefined;
  if (props) {
    for (const key of Object.keys(props)) {
      const prop = props[key] as Record<string, unknown>;
      if (prop.type === 'title' && Array.isArray(prop.title)) {
        const texts = prop.title as Array<Record<string, unknown>>;
        const t = texts.map(rt => (rt.plain_text as string) || '').join('');
        if (t) {
          title = t;
          break;
        }
      }
    }
  }

  const iconStr = extractIcon(row.icon);
  const createdBy = row.created_by as Record<string, unknown> | undefined;
  const lastEditedBy = row.last_edited_by as Record<string, unknown> | undefined;

  // Store full properties as JSON and extract text for search
  const propertiesJson = props ? JSON.stringify(props) : null;
  const propertiesText = props ? extractPropertiesText(props) : null;

  db.exec(
    `INSERT INTO database_rows (
      id, credential_id, database_id, title, url, icon, properties_json, properties_text,
      created_by_id, last_edited_by_id,
      created_time, last_edited_time, archived, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(credential_id, id) DO UPDATE SET
      database_id = excluded.database_id,
      title = excluded.title,
      url = excluded.url,
      icon = excluded.icon,
      properties_json = excluded.properties_json,
      properties_text = excluded.properties_text,
      created_by_id = excluded.created_by_id,
      last_edited_by_id = excluded.last_edited_by_id,
      created_time = excluded.created_time,
      last_edited_time = excluded.last_edited_time,
      archived = excluded.archived,
      ingested = 0,
      synced_at = excluded.synced_at`,
    [
      row.id as string,
      cid,
      databaseId,
      title,
      (row.url as string) || null,
      iconStr,
      propertiesJson,
      propertiesText,
      ((createdBy ? createdBy.id : null) as string) || null,
      ((lastEditedBy ? lastEditedBy.id : null) as string) || null,
      row.created_time as string,
      row.last_edited_time as string,
      (row.archived as boolean) ? 1 : 0,
      now,
    ]
  );
}

/**
 * Get a single database row by ID
 */
export function getDatabaseRowById(rowId: string): LocalDatabaseRow | null {
  const cid = credId();
  return db.get('SELECT * FROM database_rows WHERE credential_id = ? AND id = ?', [
    cid,
    rowId,
  ]) as LocalDatabaseRow | null;
}

/**
 * Query local database rows with optional search and filtering
 */
export function getLocalDatabaseRows(
  options: { databaseId?: string; query?: string; limit?: number; includeArchived?: boolean } = {}
): LocalDatabaseRow[] {
  const cid = credId();
  let sql = 'SELECT * FROM database_rows WHERE credential_id = ?';
  const params: unknown[] = [cid];

  if (!options.includeArchived) {
    sql += ' AND archived = 0';
  }

  if (options.databaseId) {
    sql += ' AND database_id = ?';
    params.push(options.databaseId);
  }

  if (options.query) {
    sql += ' AND (title LIKE ? OR properties_text LIKE ?)';
    const term = `%${options.query}%`;
    params.push(term, term);
  }

  sql += ' ORDER BY last_edited_time DESC';

  const limit = options.limit || 50;
  sql += ' LIMIT ?';
  params.push(limit);

  return db.all(sql, params) as unknown as LocalDatabaseRow[];
}

// ---------------------------------------------------------------------------
// User operations
// ---------------------------------------------------------------------------

/**
 * Insert or update a user from a Notion API user object
 */
export function upsertUser(user: Record<string, unknown>): void {
  const cid = credId();
  const now = Date.now();
  const person = user.person as Record<string, unknown> | undefined;

  db.exec(
    `INSERT OR REPLACE INTO users (
      id, credential_id, name, user_type, email, avatar_url, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id as string,
      cid,
      (user.name as string) || '(Unknown)',
      (user.type as string) || 'person',
      ((person ? person.email : null) as string) || null,
      (user.avatar_url as string) || null,
      now,
    ]
  );
}

/**
 * Get all local users
 */
export function getLocalUsers(): LocalUser[] {
  const cid = credId();
  return db.all('SELECT * FROM users WHERE credential_id = ? ORDER BY name', [
    cid,
  ]) as unknown as LocalUser[];
}

// ---------------------------------------------------------------------------
// Backend submission helpers
// ---------------------------------------------------------------------------

/**
 * Get pages that have not yet been ingested into memory.
 * Only returns non-archived pages with content. Oldest first.
 */
export function getUningestedPages(limit = 500): LocalPage[] {
  const cid = credId();
  return db.all(
    `SELECT * FROM pages
     WHERE credential_id = ? AND ingested = 0 AND archived = 0
       AND content_text IS NOT NULL
     ORDER BY last_edited_time ASC LIMIT ?`,
    [cid, limit]
  ) as unknown as LocalPage[];
}

/**
 * Get database rows that have not yet been ingested into memory.
 * Only returns non-archived rows with text content. Oldest first.
 */
export function getUningestedRows(limit = 500): LocalDatabaseRow[] {
  const cid = credId();
  return db.all(
    `SELECT * FROM database_rows
     WHERE credential_id = ? AND ingested = 0 AND archived = 0
       AND properties_text IS NOT NULL AND properties_text != ''
     ORDER BY last_edited_time ASC LIMIT ?`,
    [cid, limit]
  ) as unknown as LocalDatabaseRow[];
}

/**
 * Mark a batch of page IDs as ingested into memory.
 */
export function markPagesIngested(ids: string[]): void {
  if (ids.length === 0) return;
  const cid = credId();
  for (let i = 0; i < ids.length; i += 99) {
    const batch = ids.slice(i, i + 99);
    const placeholders = batch.map(() => '?').join(',');
    db.exec(`UPDATE pages SET ingested = 1 WHERE credential_id = ? AND id IN (${placeholders})`, [
      cid,
      ...batch,
    ]);
  }
}

/**
 * Mark a batch of database row IDs as ingested into memory.
 */
export function markRowsIngested(ids: string[]): void {
  if (ids.length === 0) return;
  const cid = credId();
  for (let i = 0; i < ids.length; i += 99) {
    const batch = ids.slice(i, i + 99);
    const placeholders = batch.map(() => '?').join(',');
    db.exec(
      `UPDATE database_rows SET ingested = 1 WHERE credential_id = ? AND id IN (${placeholders})`,
      [cid, ...batch]
    );
  }
}

// Register ingestion helpers on globalThis for bundled/IIFE/test harness access
if (typeof globalThis !== 'undefined') {
  const g = globalThis as Record<string, unknown>;
  g.getUningestedPages = getUningestedPages;
  g.getUningestedRows = getUningestedRows;
  g.markPagesIngested = markPagesIngested;
  g.markRowsIngested = markRowsIngested;
}

// ---------------------------------------------------------------------------
// Aggregate queries
// ---------------------------------------------------------------------------

/**
 * Get entity counts for status reporting
 */
export function getEntityCounts(): {
  pages: number;
  databases: number;
  databaseRows: number;
  pagesWithContent: number;
  pagesWithSummary: number;
  summariesTotal: number;
  summariesPending: number;
} {
  const cid = credId();
  const pages = db.get('SELECT COUNT(*) as cnt FROM pages WHERE credential_id = ?', [cid]) as {
    cnt: number;
  } | null;
  const databases = db.get('SELECT COUNT(*) as cnt FROM databases WHERE credential_id = ?', [
    cid,
  ]) as { cnt: number } | null;
  const databaseRows = db.get('SELECT COUNT(*) as cnt FROM database_rows WHERE credential_id = ?', [
    cid,
  ]) as { cnt: number } | null;
  const pagesWithContent = db.get(
    'SELECT COUNT(*) as cnt FROM pages WHERE credential_id = ? AND content_text IS NOT NULL',
    [cid]
  ) as { cnt: number } | null;
  const pagesWithSummary = db.get(
    'SELECT COUNT(DISTINCT page_id) as cnt FROM summaries WHERE credential_id = ?',
    [cid]
  ) as { cnt: number } | null;
  const summariesTotal = db.get('SELECT COUNT(*) as cnt FROM summaries WHERE credential_id = ?', [
    cid,
  ]) as { cnt: number } | null;
  const summariesPending = db.get(
    'SELECT COUNT(*) as cnt FROM summaries WHERE credential_id = ? AND synced = 0',
    [cid]
  ) as { cnt: number } | null;

  return {
    pages: (pages ? pages.cnt : 0) || 0,
    databases: (databases ? databases.cnt : 0) || 0,
    databaseRows: (databaseRows ? databaseRows.cnt : 0) || 0,
    pagesWithContent: (pagesWithContent ? pagesWithContent.cnt : 0) || 0,
    pagesWithSummary: (pagesWithSummary ? pagesWithSummary.cnt : 0) || 0,
    summariesTotal: (summariesTotal ? summariesTotal.cnt : 0) || 0,
    summariesPending: (summariesPending ? summariesPending.cnt : 0) || 0,
  };
}
