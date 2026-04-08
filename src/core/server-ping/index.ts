// server-ping/index.ts — Orchestrator
// Comprehensive demo skill showcasing all V8 runtime capabilities.
import './db/helpers';
import './db/schema';
import './setup';
import './state';
import type { ServerPingState } from './state';
import {
  getPingHistoryTool,
  getPingStatsTool,
  listPeerSkillsTool,
  pingNowTool,
  readConfigTool,
  updateServerUrlTool,
} from './tools';
import type { SkillConfig } from './types';

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

function getSkillState(): ServerPingState {
  return (globalThis as any).getSkillState();
}

async function init(): Promise<void> {
  console.log(`[server-ping] Initializing on ${platform.os()}`);
  globalThis.initializeServerPingSchema();
  const s = getSkillState();

  // Load persisted config from store
  const saved = state.get('config') as Partial<SkillConfig> | null;
  if (saved) {
    s.config.serverUrl = saved.serverUrl != null ? saved.serverUrl : s.config.serverUrl;
    s.config.pingIntervalSec =
      saved.pingIntervalSec != null ? saved.pingIntervalSec : s.config.pingIntervalSec;
    s.config.notifyOnDown = saved.notifyOnDown != null ? saved.notifyOnDown : s.config.notifyOnDown;
    s.config.notifyOnRecover =
      saved.notifyOnRecover != null ? saved.notifyOnRecover : s.config.notifyOnRecover;
    s.config.verboseLogging =
      saved.verboseLogging != null ? saved.verboseLogging : s.config.verboseLogging;
  }

  // Fall back to the host's backend URL if no server URL is configured yet
  if (!s.config.serverUrl) {
    const envUrl = platform.env('BACKEND_URL') || platform.env('BACKEND_URL');
    if (envUrl) {
      s.config.serverUrl = envUrl;
      console.log(`[server-ping] Using BACKEND_URL from env: ${envUrl}`);
    }
  }

  // Load counters from store
  const counters = state.get('counters') as { pingCount?: number; failCount?: number } | null;
  if (counters) {
    s.pingCount = counters.pingCount || 0;
    s.failCount = counters.failCount || 0;
  }

  console.log(`[server-ping] Config loaded — target: ${s.config.serverUrl}`);
}

async function start(): Promise<void> {
  const s = getSkillState();

  if (!s.config.serverUrl) {
    console.warn('[server-ping] No server URL configured — waiting for setup');
    return;
  }

  const intervalMs = s.config.pingIntervalSec * 1000;
  console.log(
    `[server-ping] Starting — ping every ${s.config.pingIntervalSec}s (using setInterval)`
  );

  if (s.pingIntervalId !== null) {
    clearInterval(s.pingIntervalId);
  }

  s.pingIntervalId = setInterval(() => {
    doPing();
  }, intervalMs) as unknown as number;

  doPing();
  publishState();
}

async function stop(): Promise<void> {
  console.log('[server-ping] Stopping');
  const s = getSkillState();

  if (s.pingIntervalId !== null) {
    clearInterval(s.pingIntervalId);
    s.pingIntervalId = null;
  }

  state.set('counters', { pingCount: s.pingCount, failCount: s.failCount });
  state.set('status', 'stopped');
}

// ---------------------------------------------------------------------------
// Options (runtime-configurable)
// ---------------------------------------------------------------------------

async function onListOptions(): Promise<{ options: SkillOption[] }> {
  const s = getSkillState();
  return {
    options: [
      {
        name: 'pingIntervalSec',
        type: 'select',
        label: 'Ping interval',
        description: 'How often to check the server',
        value: String(s.config.pingIntervalSec),
        options: [
          { label: 'Every 5 seconds', value: '5' },
          { label: 'Every 10 seconds', value: '10' },
          { label: 'Every 30 seconds', value: '30' },
          { label: 'Every 60 seconds', value: '60' },
        ],
      },
      {
        name: 'notifyOnDown',
        type: 'boolean',
        label: 'Notify on server down',
        description: 'Send desktop notification when server is unreachable',
        value: s.config.notifyOnDown,
      },
      {
        name: 'notifyOnRecover',
        type: 'boolean',
        label: 'Notify on recovery',
        description: 'Send desktop notification when server recovers',
        value: s.config.notifyOnRecover,
      },
      {
        name: 'verboseLogging',
        type: 'boolean',
        label: 'Verbose logging',
        description: 'Log every ping result to console',
        value: s.config.verboseLogging,
      },
    ],
  };
}

async function onSetOption(args: { name: string; value: unknown }): Promise<void> {
  const { name, value } = args;
  const s = getSkillState();

  if (name === 'pingIntervalSec') {
    const newInterval = parseInt(value as string) || 10;
    s.config.pingIntervalSec = newInterval;

    if (s.pingIntervalId !== null) {
      clearInterval(s.pingIntervalId);
      const intervalMs = newInterval * 1000;
      s.pingIntervalId = setInterval(() => {
        doPing();
      }, intervalMs) as unknown as number;
    }
    console.log(`[server-ping] Ping interval changed to ${newInterval}s`);
  } else if (name === 'notifyOnDown') {
    s.config.notifyOnDown = !!value;
  } else if (name === 'notifyOnRecover') {
    s.config.notifyOnRecover = !!value;
  } else if (name === 'verboseLogging') {
    s.config.verboseLogging = !!value;
  }

  state.set('config', s.config);
  publishState();
  console.log(`[server-ping] Option '${name}' set to ${value}`);
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

async function onSessionStart(args: { sessionId: string }): Promise<void> {
  const { sessionId } = args;
  const s = getSkillState();
  s.activeSessions.push(sessionId);
  console.log(`[server-ping] Session started: ${sessionId} (active: ${s.activeSessions.length})`);
}

async function onSessionEnd(args: { sessionId: string }): Promise<void> {
  const { sessionId } = args;
  const s = getSkillState();
  s.activeSessions = s.activeSessions.filter(sid => sid !== sessionId);
  console.log(`[server-ping] Session ended: ${sessionId} (active: ${s.activeSessions.length})`);
}

// ---------------------------------------------------------------------------
// Cron handler (legacy — now using setInterval instead)
// ---------------------------------------------------------------------------

async function onCronTrigger(_scheduleId: string): Promise<void> {
  // No longer using cron — ping is driven by setInterval in start()
}

// ---------------------------------------------------------------------------
// Ping logic
// ---------------------------------------------------------------------------

async function doPing(): Promise<void> {
  const s = getSkillState();
  s.pingCount++;
  const timestamp = new Date().toISOString();
  const startTime = Date.now();

  try {
    const response = await net.fetch(s.config.serverUrl, { method: 'GET', timeout: 10 });

    const latencyMs = Date.now() - startTime;
    const success = response.status >= 200 && response.status < 400;

    if (!success) {
      s.failCount++;
      s.consecutiveFails++;
    } else {
      if (s.wasDown && s.config.notifyOnRecover) {
        sendNotification(
          'Server Recovered',
          `${s.config.serverUrl} is back online (was down for ${s.consecutiveFails} checks)`
        );
      }
      s.consecutiveFails = 0;
      s.wasDown = false;
    }

    if (s.config.verboseLogging) {
      console.log(`[server-ping] #${s.pingCount} ${response.status} ${latencyMs}ms`);
    }

    globalThis.serverPingDb.logPing(
      timestamp,
      s.config.serverUrl,
      response.status,
      latencyMs,
      success,
      null
    );
  } catch (e) {
    const latencyMs = Date.now() - startTime;
    s.failCount++;
    s.consecutiveFails++;

    console.error(`[server-ping] #${s.pingCount} FAILED: ${e}`);

    globalThis.serverPingDb.logPing(timestamp, s.config.serverUrl, 0, latencyMs, false, String(e));

    if (s.consecutiveFails === 1 && s.config.notifyOnDown) {
      s.wasDown = true;
      sendNotification('Server Down', `${s.config.serverUrl} is unreachable: ${e}`);
    }
  }

  if (s.pingCount % 10 === 0) {
    state.set('counters', { pingCount: s.pingCount, failCount: s.failCount });
  }

  publishState();
  appendDataLog(timestamp);
}

// ---------------------------------------------------------------------------
// State publishing (real-time frontend updates)
// ---------------------------------------------------------------------------

function publishState(): void {
  const s = getSkillState();

  const uptimePct =
    s.pingCount > 0 ? Math.round(((s.pingCount - s.failCount) / s.pingCount) * 10000) / 100 : 100;

  const latest = globalThis.serverPingDb.getLatestPing();

  state.setPartial({
    status: s.consecutiveFails > 0 ? 'down' : 'healthy',
    pingCount: s.pingCount,
    failCount: s.failCount,
    consecutiveFails: s.consecutiveFails,
    uptimePercent: uptimePct,
    lastLatencyMs: latest ? latest.latency_ms : null,
    lastStatus: latest ? latest.status : null,
    serverUrl: s.config.serverUrl,
    activeSessions: s.activeSessions.length,
    platform: platform.os(),
  });
}

// ---------------------------------------------------------------------------
// Data file logging
// ---------------------------------------------------------------------------

function appendDataLog(timestamp: string): void {
  const recent = globalThis.serverPingDb.getRecentPings(20);

  const lines = ['# Ping Log (last 20 entries)', `# Generated: ${timestamp}`, ''];
  for (const r of recent) {
    const statusStr = r.success ? `OK ${r.status}` : 'FAIL';
    lines.push(
      `${r.timestamp} | ${statusStr} | ${r.latency_ms}ms${r.error ? ` | ${r.error}` : ''}`
    );
  }
  data.write('ping-log.txt', lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function sendNotification(title: string, body: string): void {
  const currentOs = platform.os();
  if (currentOs === 'android' || currentOs === 'ios') {
    console.log(`[server-ping] Notification (mobile, skipped): ${title} — ${body}`);
    return;
  }
  try {
    platform.notify(title, body);
  } catch (e) {
    console.warn(`[server-ping] Notification failed: ${e}`);
  }
}

// ---------------------------------------------------------------------------
// Expose on globalThis for bundled tool modules and test harness
// ---------------------------------------------------------------------------

const _g = globalThis as Record<string, unknown>;
_g.doPing = doPing;
_g.publishState = publishState;
_g.init = init;
_g.start = start;
_g.stop = stop;
_g.onCronTrigger = onCronTrigger;
_g.onSetupStart = globalThis.serverPingSetup.onSetupStart;
_g.onSetupSubmit = globalThis.serverPingSetup.onSetupSubmit;
_g.onSetupCancel = globalThis.serverPingSetup.onSetupCancel;
_g.onListOptions = onListOptions;
_g.onSetOption = onSetOption;
_g.onSessionStart = onSessionStart;
_g.onSessionEnd = onSessionEnd;

// ---------------------------------------------------------------------------
// Skill export
// ---------------------------------------------------------------------------

const tools = [
  getPingStatsTool,
  getPingHistoryTool,
  pingNowTool,
  listPeerSkillsTool,
  updateServerUrlTool,
  readConfigTool,
];

const skill: Skill = {
  info: {
    id: 'server-ping',
    name: 'Server Ping',
    version: '2.2.0',
    description:
      'Monitors server health with configurable ping intervals using setInterval. Demos setup flow, DB, state, data, net, platform, skills interop, options, and tools.',
    auto_start: false,
    setup: { required: true, label: 'Configure Server Ping' },
  },
  tools,
  init,
  start,
  stop,
  onCronTrigger,
  onSetupStart: globalThis.serverPingSetup.onSetupStart,
  onSetupSubmit: globalThis.serverPingSetup.onSetupSubmit,
  onSetupCancel: globalThis.serverPingSetup.onSetupCancel,
  onListOptions,
  onSetOption,
  onSessionStart,
  onSessionEnd,
};

export default skill;
