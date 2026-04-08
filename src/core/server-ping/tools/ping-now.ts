// Tool: ping-now
// Trigger an immediate ping to the configured server and return the result.

export const pingNowTool: ToolDefinition = {
  name: 'ping-now',
  description: 'Trigger an immediate ping to the configured server and return the result.',
  input_schema: { type: 'object', properties: {} },
  execute(): string {
    // doPing is exposed on globalThis by the main skill module
    const _g = globalThis as { doPing?: () => void };
    if (_g.doPing) _g.doPing();
    const s = (globalThis as any).getSkillState();
    const latest = db.get(
      'SELECT timestamp, status, latency_ms, success, error FROM ping_log ORDER BY id DESC LIMIT 1',
      []
    );
    return JSON.stringify({ triggered: true, pingNumber: s.pingCount, result: latest });
  },
};
