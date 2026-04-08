// SQLite schema for server-ping skill

export function initializeSchema(): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ping_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      url TEXT NOT NULL,
      status INTEGER,
      latency_ms INTEGER,
      success INTEGER NOT NULL,
      error TEXT
    )`,
    []
  );
}

declare global {
  var initializeServerPingSchema: () => void;
}
globalThis.initializeServerPingSchema = initializeSchema;
