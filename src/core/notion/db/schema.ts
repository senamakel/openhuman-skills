// Database schema initialization for Notion skill
// Creates SQLite tables for pages, databases, users, and sync state
// All tables are scoped by credential_id to isolate data per integration.
import '../state';

/**
 * Initialize Notion database schema
 */
export function initializeNotionSchema(): void {
  console.log('[notion] Initializing database schema...');

  // Pages table: metadata + extracted content
  db.exec(
    `CREATE TABLE IF NOT EXISTS pages (
      id TEXT NOT NULL,
      credential_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      url TEXT,
      icon TEXT,
      parent_type TEXT NOT NULL,
      parent_id TEXT,
      created_by_id TEXT,
      last_edited_by_id TEXT,
      created_time TEXT NOT NULL,
      last_edited_time TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      content_text TEXT,
      content_synced_at INTEGER,
      page_entities TEXT,
      ingested INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER NOT NULL,
      PRIMARY KEY (credential_id, id)
    )`,
    []
  );

  // Databases table: metadata
  db.exec(
    `CREATE TABLE IF NOT EXISTS databases (
      id TEXT NOT NULL,
      credential_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      description TEXT,
      url TEXT,
      icon TEXT,
      property_count INTEGER NOT NULL DEFAULT 0,
      created_time TEXT NOT NULL,
      last_edited_time TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      ingested INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER NOT NULL,
      PRIMARY KEY (credential_id, id)
    )`,
    []
  );

  // Users table
  db.exec(
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT NOT NULL,
      credential_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      user_type TEXT NOT NULL,
      email TEXT,
      avatar_url TEXT,
      synced_at INTEGER NOT NULL,
      PRIMARY KEY (credential_id, id)
    )`,
    []
  );

  // Database rows table: stores rows/entries within databases with their properties
  db.exec(
    `CREATE TABLE IF NOT EXISTS database_rows (
      id TEXT NOT NULL,
      credential_id TEXT NOT NULL DEFAULT '',
      database_id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      icon TEXT,
      properties_json TEXT,
      properties_text TEXT,
      created_by_id TEXT,
      last_edited_by_id TEXT,
      created_time TEXT NOT NULL,
      last_edited_time TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      ingested INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER NOT NULL,
      PRIMARY KEY (credential_id, id),
      FOREIGN KEY (credential_id, database_id) REFERENCES databases(credential_id, id)
    )`,
    []
  );

  // Summaries table: stores AI-generated summaries with sync tracking
  // page_id holds the source ID (page or database row)
  db.exec(
    `CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credential_id TEXT NOT NULL DEFAULT '',
      page_id TEXT NOT NULL,
      url TEXT,
      summary TEXT NOT NULL,
      category TEXT,
      sentiment TEXT,
      entities TEXT,
      topics TEXT,
      metadata TEXT,
      source_created_at TEXT NOT NULL,
      source_updated_at TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      synced INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER
    )`,
    []
  );

  // ---------------------------------------------------------------------------
  // Migrations for existing installs
  // ---------------------------------------------------------------------------

  // Migrate: add credential_id to all tables
  migrateAddColumn('pages', 'credential_id', "TEXT NOT NULL DEFAULT ''");
  migrateAddColumn('databases', 'credential_id', "TEXT NOT NULL DEFAULT ''");
  migrateAddColumn('users', 'credential_id', "TEXT NOT NULL DEFAULT ''");
  migrateAddColumn('database_rows', 'credential_id', "TEXT NOT NULL DEFAULT ''");
  migrateAddColumn('summaries', 'credential_id', "TEXT NOT NULL DEFAULT ''");

  // Migrate: add ingested to content tables
  migrateAddColumn('pages', 'ingested', 'INTEGER NOT NULL DEFAULT 0');
  migrateAddColumn('databases', 'ingested', 'INTEGER NOT NULL DEFAULT 0');
  migrateAddColumn('database_rows', 'ingested', 'INTEGER NOT NULL DEFAULT 0');

  // Migrate: add page_entities column if it doesn't exist (for existing installs)
  migrateAddColumn('pages', 'page_entities', 'TEXT');

  // Migrate: add url column to summaries if it doesn't exist (for existing installs)
  migrateAddColumn('summaries', 'url', 'TEXT');

  // Migrate: composite primary key (credential_id, id) for credential isolation
  migrateCompositePrimaryKey(
    'pages',
    `CREATE TABLE pages_new (
      id TEXT NOT NULL,
      credential_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      url TEXT,
      icon TEXT,
      parent_type TEXT NOT NULL,
      parent_id TEXT,
      created_by_id TEXT,
      last_edited_by_id TEXT,
      created_time TEXT NOT NULL,
      last_edited_time TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      content_text TEXT,
      content_synced_at INTEGER,
      page_entities TEXT,
      ingested INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER NOT NULL,
      PRIMARY KEY (credential_id, id)
    )`
  );
  migrateCompositePrimaryKey(
    'databases',
    `CREATE TABLE databases_new (
      id TEXT NOT NULL,
      credential_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      description TEXT,
      url TEXT,
      icon TEXT,
      property_count INTEGER NOT NULL DEFAULT 0,
      created_time TEXT NOT NULL,
      last_edited_time TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      ingested INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER NOT NULL,
      PRIMARY KEY (credential_id, id)
    )`
  );
  migrateCompositePrimaryKey(
    'users',
    `CREATE TABLE users_new (
      id TEXT NOT NULL,
      credential_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      user_type TEXT NOT NULL,
      email TEXT,
      avatar_url TEXT,
      synced_at INTEGER NOT NULL,
      PRIMARY KEY (credential_id, id)
    )`
  );
  migrateCompositePrimaryKey(
    'database_rows',
    `CREATE TABLE database_rows_new (
      id TEXT NOT NULL,
      credential_id TEXT NOT NULL DEFAULT '',
      database_id TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      icon TEXT,
      properties_json TEXT,
      properties_text TEXT,
      created_by_id TEXT,
      last_edited_by_id TEXT,
      created_time TEXT NOT NULL,
      last_edited_time TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      ingested INTEGER NOT NULL DEFAULT 0,
      synced_at INTEGER NOT NULL,
      PRIMARY KEY (credential_id, id),
      FOREIGN KEY (credential_id, database_id) REFERENCES databases(credential_id, id)
    )`
  );

  // ---------------------------------------------------------------------------
  // Indexes
  // ---------------------------------------------------------------------------

  // credential_id indexes for scoped queries
  db.exec('CREATE INDEX IF NOT EXISTS idx_pages_cred ON pages(credential_id)', []);
  db.exec('CREATE INDEX IF NOT EXISTS idx_databases_cred ON databases(credential_id)', []);
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_cred ON users(credential_id)', []);
  db.exec('CREATE INDEX IF NOT EXISTS idx_db_rows_cred ON database_rows(credential_id)', []);
  db.exec('CREATE INDEX IF NOT EXISTS idx_summaries_cred ON summaries(credential_id)', []);

  // ingested indexes for submission queries
  db.exec('CREATE INDEX IF NOT EXISTS idx_pages_ingested ON pages(credential_id, ingested)', []);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_databases_ingested ON databases(credential_id, ingested)',
    []
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_db_rows_ingested ON database_rows(credential_id, ingested)',
    []
  );

  // Query performance indexes
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pages_last_edited ON pages(credential_id, last_edited_time DESC)',
    []
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(credential_id, parent_type, parent_id)',
    []
  );
  db.exec('CREATE INDEX IF NOT EXISTS idx_pages_archived ON pages(credential_id, archived)', []);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_databases_last_edited ON databases(credential_id, last_edited_time DESC)',
    []
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_db_rows_database_id ON database_rows(credential_id, database_id)',
    []
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_db_rows_last_edited ON database_rows(credential_id, last_edited_time DESC)',
    []
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_summaries_synced ON summaries(credential_id, synced)',
    []
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_summaries_page_id ON summaries(credential_id, page_id)',
    []
  );

  console.log('[notion] Database schema initialized successfully');
}

// ---------------------------------------------------------------------------
// Migration helper
// ---------------------------------------------------------------------------

/** Safely add a column to an existing table. No-op if the column already exists. */
function migrateAddColumn(table: string, column: string, type: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`, []);
    console.log(`[notion] Added ${column} column to ${table} table`);
  } catch {
    // Column already exists — expected for new installs
  }
}

/**
 * Recreate a table with composite PRIMARY KEY (credential_id, id) for credential isolation.
 * No-op if the table already has the composite key. Drops and recreates indexes via later CREATE INDEX.
 * Uses an explicit column list for the INSERT/SELECT so column ordering is stable and future schema changes don't break the migration.
 */
function migrateCompositePrimaryKey(tableName: string, createNewTableSql: string): void {
  try {
    const row = db.get('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?', [
      'table',
      tableName,
    ]) as { sql: string } | undefined;
    if (!row || !row.sql || row.sql.includes('PRIMARY KEY (credential_id, id)')) return;
    const newTableName = `${tableName}_new`;
    db.exec(createNewTableSql, []);
    const columns = db.all(`PRAGMA table_info(${tableName})`, []) as Array<{
      cid: number;
      name: string;
    }>;
    const columnList = columns
      .sort((a, b) => a.cid - b.cid)
      .map(c => c.name)
      .join(', ');
    db.exec(
      `INSERT INTO ${newTableName} (${columnList}) SELECT ${columnList} FROM ${tableName}`,
      []
    );
    db.exec(`DROP TABLE ${tableName}`, []);
    db.exec(`ALTER TABLE ${newTableName} RENAME TO ${tableName}`, []);
    console.log(`[notion] Migrated ${tableName} to composite primary key (credential_id, id)`);
  } catch (e) {
    console.warn(`[notion] migrateCompositePrimaryKey(${tableName}):`, e);
  }
}
