#!/usr/bin/env npx tsx

/**
 * Notion sync live test.
 *
 * Starts the skill, authenticates, triggers sync, and polls until done.
 * All heavy lifting (progress, content fetch, ingestion) is in sync.ts —
 * this script just observes and verifies.
 *
 * Usage:
 *   npx tsx src/core/notion/live-test-sync.ts
 */
import 'dotenv/config';

import {
  callToolRaw,
  getSkillStatus,
  oauthComplete,
  setSetupComplete,
  skillRpc,
  startSkill,
  stopSkill,
} from '../../../dev/test-harness';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

const header = (t: string) =>
  console.log(`\n${C.cyan}${'─'.repeat(60)}\n  ${t}\n${'─'.repeat(60)}${C.reset}`);
const step = (l: string) => process.stdout.write(`${C.blue}  ▸ ${l}${C.reset} `);
const ok = (d?: string) =>
  console.log(`${C.green}✓${C.reset}${d ? ` ${C.dim}${d}${C.reset}` : ''}`);
const fail = (d: string) => console.log(`${C.red}✗ ${d}${C.reset}`);
const info = (l: string, v: unknown) => console.log(`${C.dim}    ${l}: ${C.reset}${v}`);
const ts = () => new Date().toISOString().slice(11, 19);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKILL_ID = 'notion';

async function callTool(
  name: string,
  args: Record<string, unknown> = {},
  timeoutMs = 15_000
): Promise<{ data?: any; error?: string; ms: number }> {
  const t0 = Date.now();
  try {
    const r = await callToolRaw(SKILL_ID, name, args, timeoutMs);
    const ms = Date.now() - t0;
    const text = r.content && r.content[0] ? r.content[0].text : '';
    if (r.is_error) return { error: text || 'unknown', ms };
    if (!text) return { data: null, ms };
    try {
      const p = JSON.parse(text);
      if (p.error && typeof p.error === 'string') return { error: p.error, ms };
      return { data: p, ms };
    } catch {
      return { data: text, ms };
    }
  } catch (e: any) {
    return { error: e.message, ms: Date.now() - t0 };
  }
}

async function getState(): Promise<Record<string, unknown> | null> {
  try {
    const snap = await getSkillStatus(SKILL_ID);
    return (snap.state as Record<string, unknown>) || null;
  } catch {
    return null;
  }
}

function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = Date.now();
  return fn().then(r => [r, Date.now() - t0]);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const INTEGRATION_ID = (process.env.NOTION_INTEGRATION_ID || '').trim();
const CLIENT_KEY = (process.env.NOTION_CLIENT_KEY_SHARE || '').trim();

if (!process.env.JWT_TOKEN || !INTEGRATION_ID || !CLIENT_KEY) {
  console.error(
    `\n${C.red}  Missing env vars: JWT_TOKEN, NOTION_INTEGRATION_ID, NOTION_CLIENT_KEY_SHARE${C.reset}\n`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n${C.bold}  Notion Sync — Live Test${C.reset}`);

  // ── 1. Setup ──────────────────────────────────────────────────────────

  header('1. Setup');

  step('Stop existing...');
  try {
    await stopSkill(SKILL_ID);
    ok();
  } catch {
    ok('(not running)');
  }

  step('Start skill...');
  const [snap, startMs] = await timed(() => startSkill(SKILL_ID));
  ok(`tools=${snap.tools.length} (${startMs}ms)`);

  step('OAuth...');
  const [, oauthMs] = await timed(() =>
    oauthComplete(SKILL_ID, {
      credentialId: INTEGRATION_ID,
      provider: 'notion',
      grantedScopes: [],
      clientKeyShare: CLIENT_KEY,
    })
  );
  ok(`${oauthMs}ms`);

  step('Setup complete...');
  const [, setupMs] = await timed(() => setSetupComplete(SKILL_ID, true));
  ok(`${setupMs}ms`);

  await new Promise(r => setTimeout(r, 1500));

  // ── 2. Pre-sync check ────────────────────────────────────────────────

  header('2. Pre-Sync');

  step('list-users...');
  const {
    data: users,
    error: userErr,
    ms: userMs,
  } = await callTool('list-users', { page_size: 100 }, 30_000);
  if (userErr) {
    fail(`${userErr} (${userMs}ms)`);
    process.exit(1);
  }
  ok(`${users.count} users (${userMs}ms)`);

  step('sync-status...');
  const { data: ss, ms: ssMs } = await callTool('sync-status');
  if (ss) {
    info('pages', ss.totals ? ss.totals.pages : 0);
    info('databases', ss.totals ? ss.totals.databases : 0);
  }
  ok(`${ssMs}ms`);

  // ── 3. Trigger sync ──────────────────────────────────────────────────

  header('3. Sync');

  step('Triggering skill/sync...');
  const [syncResult, triggerMs] = await timed(() => skillRpc(SKILL_ID, 'skill/sync', {}));
  ok(`${JSON.stringify(syncResult)} (${triggerMs}ms)`);

  // ── 4. Poll ──────────────────────────────────────────────────────────

  // Capture initial lastSyncTime so we can detect when a new sync completes
  const preSync = await getState();
  const initialLastSyncTime = preSync ? (preSync.lastSyncTime as string | null) : null;

  const t0 = Date.now();
  let lastLine = '';
  let stale = 0;

  while (Date.now() - t0 < 10 * 60 * 1000) {
    await new Promise(r => setTimeout(r, 2000));

    const s = await getState();
    if (!s) {
      console.log(`${C.yellow}    [${ts()}] state=null${C.reset}`);
      continue;
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    const phase = (s.syncPhase as string) || '-';
    const pct = (s.syncProgress as number) || 0;
    const msg = (s.syncMessage as string) || '';
    const pages = (s.totalPages as number) || 0;
    const dbs = (s.totalDatabases as number) || 0;
    const content = (s.pagesWithContent as number) || 0;
    const inProg = s.syncInProgress;
    const err = s.lastSyncError as string | null;
    const currentSyncTime = s.lastSyncTime as string | null;

    const line = `${phase}|${pct}|${msg}`;
    if (line === lastLine) {
      stale++;
    } else {
      stale = 0;
    }
    lastLine = line;

    const staleTag = stale >= 5 ? ` ${C.yellow}STALE(${stale})${C.reset}` : '';
    console.log(
      `    [${C.dim}${elapsed}s${C.reset}] ${C.cyan}[${pct}%]${C.reset} ` +
        `${C.bold}${phase}${C.reset} ${msg} ` +
        `| p=${pages} db=${dbs} c=${content} run=${inProg}${staleTag}`
    );

    if (err) console.log(`    ${C.red}⚠ ${err}${C.reset}`);

    // Sync is done when not in progress AND lastSyncTime advanced (handles empty workspaces)
    const syncTimeAdvanced = currentSyncTime && currentSyncTime !== initialLastSyncTime;
    if (!inProg && (syncTimeAdvanced || pages > 0)) {
      if (err) {
        fail(`Sync error: ${err}`);
      } else {
        ok(`Sync done in ${elapsed}s`);
      }
      break;
    }

    if (stale >= 30) {
      fail(`Stuck for ${stale} polls`);
      break;
    }
  }

  // ── 5. Results ───────────────────────────────────────────────────────

  header('4. Results');

  const post = await getState();
  if (post) {
    info('totalPages', post.totalPages);
    info('totalDatabases', post.totalDatabases);
    info('pagesWithContent', post.pagesWithContent);
    info('lastSyncTime', post.lastSyncTime);
    info('lastSyncDurationMs', post.lastSyncDurationMs);
    info('lastSyncError', post.lastSyncError || '(none)');

    if (post.lastSyncError) fail(`${post.lastSyncError}`);
    else if (post.lastSyncTime) ok();
    else fail('lastSyncTime not set');
  }

  // ── 6. Cache ─────────────────────────────────────────────────────────

  header('5. Cache');

  for (const [tool, args, label] of [
    ['list-pages', { page_size: 5, tryCache: true }, 'pages'] as const,
    ['list-databases', { page_size: 5, tryCache: true }, 'dbs'] as const,
    ['list-users', { tryCache: true }, 'users'] as const,
  ]) {
    step(`${label} (cache)...`);
    const { data, error, ms } = await callTool(tool, args);
    if (error) fail(`${error} (${ms}ms)`);
    else ok(`${data.count} ${label} (${ms}ms, src=${data.source})`);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  step('Stop...');
  try {
    await stopSkill(SKILL_ID);
    ok();
  } catch (e: any) {
    fail(e.message);
  }

  console.log(`\n${C.green}${C.bold}  Done.${C.reset}\n`);
  process.exit(0);
}

main().catch(e => {
  console.error(`\n${C.red}Fatal: ${e.message}${C.reset}`);
  process.exit(1);
});
