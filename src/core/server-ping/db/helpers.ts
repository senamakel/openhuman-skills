// Database helpers for server-ping skill

export function logPing(
  timestamp: string,
  url: string,
  status: number,
  latencyMs: number,
  success: boolean,
  error: string | null
): void {
  db.exec(
    'INSERT INTO ping_log (timestamp, url, status, latency_ms, success, error) VALUES (?, ?, ?, ?, ?, ?)',
    [timestamp, url, status, latencyMs, success ? 1 : 0, error]
  );
}

export function getLatestPing(): { latency_ms: number; status: number; success: number } | null {
  return db.get(
    'SELECT latency_ms, status, success FROM ping_log ORDER BY id DESC LIMIT 1',
    []
  ) as { latency_ms: number; status: number; success: number } | null;
}

export function getRecentPings(
  limit: number
): {
  timestamp: string;
  status: number;
  latency_ms: number;
  success: number;
  error: string | null;
}[] {
  return db.all(
    'SELECT timestamp, status, latency_ms, success, error FROM ping_log ORDER BY id DESC LIMIT ?',
    [limit]
  ) as {
    timestamp: string;
    status: number;
    latency_ms: number;
    success: number;
    error: string | null;
  }[];
}

declare global {
  var serverPingDb: {
    logPing: typeof logPing;
    getLatestPing: typeof getLatestPing;
    getRecentPings: typeof getRecentPings;
  };
}
globalThis.serverPingDb = { logPing, getLatestPing, getRecentPings };
