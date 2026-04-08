#!/usr/bin/env npx tsx

/**
 * Gmail sync live test.
 *
 * Starts the skill, authenticates, triggers sync, and polls until done.
 * Similar to the Notion sync test — just an observer.
 *
 * Usage:
 *   npx tsx src/core/gmail/live-test-sync.ts
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

const SKILL_ID = 'gmail';

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

const INTEGRATION_ID = (process.env.GMAIL_INTEGRATION_ID || '').trim();
const CLIENT_KEY = (process.env.GMAIL_CLIENT_KEY_SHARE || '').trim();

if (!process.env.JWT_TOKEN || !INTEGRATION_ID || !CLIENT_KEY) {
  console.error(
    `\n${C.red}  Missing env vars: JWT_TOKEN, GMAIL_INTEGRATION_ID, GMAIL_CLIENT_KEY_SHARE${C.reset}\n`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n${C.bold}  Gmail Sync — Live Test${C.reset}`);

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
      provider: 'gmail',
      grantedScopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.labels',
      ],
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

  step('get-profile...');
  const {
    data: profile,
    error: profileErr,
    ms: profileMs,
  } = await callTool('get-profile', {}, 30_000);
  if (profileErr) {
    fail(`${profileErr} (${profileMs}ms)`);
  } else {
    ok(`${profile?.emailAddress || profile?.email || 'unknown'} (${profileMs}ms)`);
  }

  step('Checking state...');
  const preState = await getState();
  if (preState) {
    info('totalEmails', preState.totalEmails);
    info('syncInProgress', preState.syncInProgress);
    info('lastSyncTime', preState.lastSyncTime);
  }
  ok();

  // ── 3. Trigger sync ──────────────────────────────────────────────────

  header('3. Sync');

  step('Triggering skill/sync...');
  const [syncResult, triggerMs] = await timed(() => skillRpc(SKILL_ID, 'skill/sync', {}));
  ok(`${JSON.stringify(syncResult)} (${triggerMs}ms)`);

  // ── 4. Poll ──────────────────────────────────────────────────────────

  const t0 = Date.now();
  let lastLine = '';
  let stale = 0;

  while (Date.now() - t0 < 5 * 60 * 1000) {
    await new Promise(r => setTimeout(r, 2000));

    const s = await getState();
    if (!s) {
      console.log(`${C.yellow}    [${ts()}] state=null${C.reset}`);
      continue;
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    const pct = (s.syncProgress as number) || 0;
    const msg = (s.syncProgressMessage as string) || '';
    const total = (s.totalEmails as number) || 0;
    const newCount = (s.newEmailsCount as number) || 0;
    const inProg = s.syncInProgress;
    const err = s.lastError as string | null;

    const line = `${pct}|${msg}`;
    if (line === lastLine) {
      stale++;
    } else {
      stale = 0;
    }
    lastLine = line;

    const staleTag = stale >= 5 ? ` ${C.yellow}STALE(${stale})${C.reset}` : '';
    console.log(
      `    [${C.dim}${elapsed}s${C.reset}] ${C.cyan}[${pct}%]${C.reset} ` +
        `${msg} ` +
        `| total=${total} new=${newCount} run=${inProg}${staleTag}`
    );

    if (err) console.log(`    ${C.red}⚠ ${err}${C.reset}`);

    if (!inProg && (total > 0 || pct >= 100)) {
      if (err) {
        fail(`Sync error: ${err}`);
      } else {
        ok(`Sync done in ${elapsed}s — ${total} emails (${newCount} new)`);
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
    info('totalEmails', post.totalEmails);
    info('newEmailsCount', post.newEmailsCount);
    info('lastSyncTime', post.lastSyncTime);
    info('syncInProgress', post.syncInProgress);
    info('lastError', post.lastError || '(none)');
    info('userEmail', post.userEmail);

    if (post.lastError) fail(`${post.lastError}`);
    else if (post.lastSyncTime) ok();
    else fail('lastSyncTime not set');
  }

  // ── 6. Tool check ───────────────────────────────────────────────────

  header('5. Tools');

  for (const [tool, args, label] of [
    ['get-profile', {}, 'profile'] as const,
    ['get-labels', {}, 'labels'] as const,
    ['get-emails', { max_results: 5 }, 'emails'] as const,
  ]) {
    step(`${label}...`);
    const { data, error, ms } = await callTool(tool, args);
    if (error) fail(`${error} (${ms}ms)`);
    else {
      const count =
        label === 'labels'
          ? (data?.labels || []).length
          : label === 'emails'
            ? (data?.emails || data?.messages || []).length
            : 1;
      ok(`${count} ${label} (${ms}ms)`);
    }
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
