// Tool: get-ping-stats
// Get current ping statistics including uptime, total pings, failures, and latest latency.

export const getPingStatsTool: ToolDefinition = {
  name: 'get-ping-stats',
  description:
    'Get current ping statistics including uptime, total pings, failures, and latest latency.',
  input_schema: { type: 'object', properties: {} },
  execute(): string {
    const s = (globalThis as any).getSkillState();

    const uptimePct =
      s.pingCount > 0 ? Math.round(((s.pingCount - s.failCount) / s.pingCount) * 10000) / 100 : 100;

    const latest = db.get(
      'SELECT latency_ms, status, timestamp FROM ping_log ORDER BY id DESC LIMIT 1',
      []
    ) as { latency_ms: number; status: number; timestamp: string } | null;

    const avgLatency = db.get(
      'SELECT AVG(latency_ms) as avg_ms FROM ping_log WHERE success = 1',
      []
    ) as { avg_ms: number | null } | null;

    return JSON.stringify({
      serverUrl: s.config.serverUrl,
      totalPings: s.pingCount,
      totalFailures: s.failCount,
      consecutiveFailures: s.consecutiveFails,
      uptimePercent: uptimePct,
      lastPing: latest
        ? { latencyMs: latest.latency_ms, status: latest.status, at: latest.timestamp }
        : null,
      avgLatencyMs: avgLatency && avgLatency.avg_ms ? Math.round(avgLatency.avg_ms) : null,
      platform: platform.os(),
    });
  },
};
