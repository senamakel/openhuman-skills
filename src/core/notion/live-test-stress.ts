#!/usr/bin/env npx tsx

/**
 * Notion API stress test.
 *
 * Fires N sequential requests through the skill runtime to surface
 * connection pooling, proxy, or timeout issues.
 *
 * Env vars (required):
 *   JWT_TOKEN                -- session JWT
 *   NOTION_INTEGRATION_ID   -- OAuth integration ID
 *   NOTION_CLIENT_KEY_SHARE -- client key share (base64)
 *
 * Usage:
 *   npx tsx src/core/notion/live-test-stress.ts [count]
 *
 *   count defaults to 10. Pass 20, 30, etc. as first arg.
 */
import 'dotenv/config';

import {
  callToolRaw,
  oauthComplete,
  setSetupComplete,
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

function header(text: string) {
  console.log(`\n${C.cyan}${'='.repeat(60)}${C.reset}`);
  console.log(`${C.cyan}  ${text}${C.reset}`);
  console.log(`${C.cyan}${'='.repeat(60)}${C.reset}`);
}

// ---------------------------------------------------------------------------
// Tool caller
// ---------------------------------------------------------------------------

const SKILL_ID = 'notion';
const TIMEOUT_MS = 15_000;

interface CallResult {
  index: number;
  tool: string;
  ok: boolean;
  elapsedMs: number;
  status?: number;
  error?: string;
  bodyLen?: number;
}

async function callTool(
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<{ ok: boolean; elapsedMs: number; status?: number; error?: string; bodyLen?: number }> {
  const t0 = Date.now();
  try {
    const result = await callToolRaw(SKILL_ID, toolName, args, TIMEOUT_MS);
    const elapsedMs = Date.now() - t0;
    const text = result.content && result.content[0] ? result.content[0].text : '';
    if (result.is_error) return { ok: false, elapsedMs, error: (text || 'unknown').slice(0, 120) };
    let status: number | undefined;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) return { ok: false, elapsedMs, error: String(parsed.error).slice(0, 120) };
      status = parsed.status;
    } catch {
      /* not JSON */
    }
    return { ok: true, elapsedMs, status, bodyLen: text.length };
  } catch (e: any) {
    return { ok: false, elapsedMs: Date.now() - t0, error: e.message.slice(0, 120) };
  }
}

// ---------------------------------------------------------------------------
// Direct proxy caller — bypasses skill runtime entirely
// ---------------------------------------------------------------------------

const BACKEND_URL = process.env.BACKEND_URL || 'https://staging-api.tinyhumans.ai';

interface DirectProxyEndpoint {
  label: string;
  path: string;
  method?: string;
  body?: unknown;
}

const proxyEndpoints: DirectProxyEndpoint[] = [
  { label: 'users', path: '/v1/users/?page_size=2' },
  {
    label: 'search-pages',
    path: '/v1/search',
    method: 'POST',
    body: { page_size: 2, filter: { property: 'object', value: 'page' } },
  },
  {
    label: 'search-dbs',
    path: '/v1/search',
    method: 'POST',
    body: { page_size: 2, filter: { property: 'object', value: 'data_source' } },
  },
  { label: 'search', path: '/v1/search', method: 'POST', body: { query: 'test', page_size: 100 } },
];

async function directProxyCall(
  ep: DirectProxyEndpoint
): Promise<{ ok: boolean; elapsedMs: number; status?: number; error?: string; bodyLen?: number }> {
  const JWT = process.env.JWT_TOKEN || '';
  const KEY = (process.env.NOTION_CLIENT_KEY_SHARE || '').trim();
  const INT_ID = (process.env.NOTION_INTEGRATION_ID || '').trim();
  const url = `${BACKEND_URL}/proxy/encrypted/${INT_ID}${ep.path}`;
  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      method: ep.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${JWT}`,
        'X-Encryption-Key': KEY,
        'Notion-Version': '2026-03-11',
      },
      body: ep.body ? JSON.stringify(ep.body) : undefined,
      signal: undefined,
    });
    const elapsedMs = Date.now() - t0;
    const text = await resp.text();
    if (resp.status >= 400)
      return { ok: false, elapsedMs, status: resp.status, error: text.slice(0, 120) };
    return { ok: true, elapsedMs, status: resp.status, bodyLen: text.length };
  } catch (e: any) {
    return { ok: false, elapsedMs: Date.now() - t0, error: e.message.slice(0, 120) };
  }
}

// ---------------------------------------------------------------------------
// Test scenarios — each is a [toolName, args] pair
// ---------------------------------------------------------------------------

type Scenario = [string, Record<string, unknown>];

const scenarios: Scenario[] = [
  ['list-users', { page_size: 100 }],
  ['list-pages', { page_size: 100 }],
  ['list-databases', { page_size: 100 }],
  ['search', { query: 'test', page_size: 100 }],
  ['sync-status', {}],
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const COUNT = parseInt(process.argv[2] || '10', 10);
const JWT_TOKEN = process.env.JWT_TOKEN || '';
const INTEGRATION_ID = (process.env.NOTION_INTEGRATION_ID || '').trim();
const CLIENT_KEY = (process.env.NOTION_CLIENT_KEY_SHARE || '').trim();

if (!JWT_TOKEN || !INTEGRATION_ID || !CLIENT_KEY) {
  console.error(
    `\n${C.red}  Missing env vars: JWT_TOKEN, NOTION_INTEGRATION_ID, NOTION_CLIENT_KEY_SHARE${C.reset}\n`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n${C.bold}  Notion API Stress Test${C.reset}`);
  console.log(
    `${C.dim}    Requests: ${COUNT} | Timeout: ${TIMEOUT_MS}ms | Scenarios: ${scenarios.length}${C.reset}`
  );

  // ── Setup ────────────────────────────────────────────────────────────────

  header('Setup');

  try {
    await stopSkill(SKILL_ID);
  } catch {
    /* not running */
  }

  let t0 = Date.now();
  process.stdout.write(`  Starting skill... `);
  const snap = await startSkill(SKILL_ID);
  console.log(
    `${C.green}OK${C.reset} (tools=${snap.tools.length}) ${C.dim}${Date.now() - t0}ms${C.reset}`
  );

  t0 = Date.now();
  process.stdout.write(`  oauthComplete... `);
  await oauthComplete(SKILL_ID, {
    credentialId: INTEGRATION_ID,
    provider: 'notion',
    grantedScopes: [],
    clientKeyShare: CLIENT_KEY,
  });
  console.log(`${C.green}OK${C.reset} ${C.dim}${Date.now() - t0}ms${C.reset}`);

  t0 = Date.now();
  process.stdout.write(`  setSetupComplete... `);
  await setSetupComplete(SKILL_ID, true);
  console.log(`${C.green}OK${C.reset} ${C.dim}${Date.now() - t0}ms${C.reset}`);

  // Wait for init
  await new Promise(r => setTimeout(r, 2000));

  // ── Direct Proxy Baseline ─────────────────────────────────────────────

  header('Direct Proxy Baseline (bypasses skill runtime)');

  for (const ep of proxyEndpoints) {
    process.stdout.write(`  ${ep.label}... `);
    const r = await directProxyCall(ep);
    if (r.ok) {
      console.log(`${C.green}OK${C.reset} ${C.dim}${r.elapsedMs}ms (${r.bodyLen}b)${C.reset}`);
    } else {
      console.log(`${C.red}FAIL${C.reset} status=${r.status} ${r.error}`);
    }
  }

  // Fire N direct proxy calls to compare with skill runtime
  header(`Direct Proxy Stress: ${COUNT} sequential requests`);

  const directResults: CallResult[] = [];
  const directStart = Date.now();

  for (let i = 0; i < COUNT; i++) {
    const ep = proxyEndpoints[i % proxyEndpoints.length];
    const label = `[${String(i + 1).padStart(3)}/${COUNT}] ${ep.label}`;
    process.stdout.write(`  ${label}... `);

    const r = await directProxyCall(ep);
    directResults.push({ index: i + 1, tool: ep.label, ...r });

    if (r.ok) {
      console.log(
        `${C.green}OK${C.reset} ${C.dim}${r.elapsedMs}ms` +
          (r.bodyLen ? ` (${r.bodyLen}b)` : '') +
          `${C.reset}`
      );
    } else {
      console.log(`${C.red}FAIL${C.reset} ${r.elapsedMs}ms — ${r.error}`);
    }
  }

  const directTotal = Date.now() - directStart;
  const directPassed = directResults.filter(r => r.ok).length;
  const directTimes = directResults.filter(r => r.ok).map(r => r.elapsedMs);
  const directAvg = directTimes.length
    ? Math.round(directTimes.reduce((a, b) => a + b, 0) / directTimes.length)
    : 0;
  console.log(
    `\n  ${C.dim}Direct proxy: ${directPassed}/${COUNT} passed, avg=${directAvg}ms, total=${(directTotal / 1000).toFixed(1)}s${C.reset}`
  );

  // ── Warmup ───────────────────────────────────────────────────────────────

  header('Skill Runtime Warmup (1 call per scenario)');

  for (const [tool, args] of scenarios) {
    process.stdout.write(`  ${tool}... `);
    const r = await callTool(tool, args);
    if (r.ok) {
      console.log(`${C.green}OK${C.reset} ${C.dim}${r.elapsedMs}ms${C.reset}`);
    } else {
      console.log(`${C.red}FAIL${C.reset} ${r.error}`);
    }
  }

  // ── Stress ───────────────────────────────────────────────────────────────

  header(`Skill Runtime Stress: ${COUNT} sequential requests`);

  const results: CallResult[] = [];
  const startTime = Date.now();

  for (let i = 0; i < COUNT; i++) {
    const [tool, args] = scenarios[i % scenarios.length];
    const label = `[${String(i + 1).padStart(3)}/${COUNT}] ${tool}`;
    process.stdout.write(`  ${label}... `);

    const r = await callTool(tool, args);
    results.push({ index: i + 1, tool, ...r });

    if (r.ok) {
      console.log(
        `${C.green}OK${C.reset} ${C.dim}${r.elapsedMs}ms` +
          (r.bodyLen ? ` (${r.bodyLen}b)` : '') +
          `${C.reset}`
      );
    } else {
      console.log(`${C.red}FAIL${C.reset} ${r.elapsedMs}ms — ${r.error}`);
    }
  }

  const totalTime = Date.now() - startTime;

  // ── Summary ──────────────────────────────────────────────────────────────

  header('Summary');

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const times = results.filter(r => r.ok).map(r => r.elapsedMs);
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const min = times.length ? Math.min(...times) : 0;
  const max = times.length ? Math.max(...times) : 0;
  const p50 = percentile(times, 50);
  const p95 = percentile(times, 95);
  const p99 = percentile(times, 99);

  console.log(`  Total requests:  ${COUNT}`);
  console.log(`  ${C.green}Passed:${C.reset}          ${passed}`);
  if (failed > 0) {
    console.log(`  ${C.red}Failed:${C.reset}          ${failed}`);
  }
  console.log(`  Total time:      ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`  Avg latency:     ${avg}ms`);
  console.log(`  Min latency:     ${min}ms`);
  console.log(`  Max latency:     ${max}ms`);
  console.log(`  P50 latency:     ${p50}ms`);
  console.log(`  P95 latency:     ${p95}ms`);
  console.log(`  P99 latency:     ${p99}ms`);
  console.log(`  Throughput:      ${(COUNT / (totalTime / 1000)).toFixed(1)} req/s`);

  // Per-tool breakdown
  const toolNames = [...new Set(results.map(r => r.tool))];
  if (toolNames.length > 1) {
    console.log(`\n  ${C.cyan}Per-tool breakdown:${C.reset}`);
    for (const tn of toolNames) {
      const tr = results.filter(r => r.tool === tn);
      const tp = tr.filter(r => r.ok);
      const tt = tp.map(r => r.elapsedMs);
      const tavg = tt.length ? Math.round(tt.reduce((a, b) => a + b, 0) / tt.length) : 0;
      const tf = tr.length - tp.length;
      const failStr = tf > 0 ? ` ${C.red}${tf} failed${C.reset}` : '';
      console.log(
        `    ${tn.padEnd(20)} ${tp.length}/${tr.length} ok  avg=${tavg}ms  min=${tt.length ? Math.min(...tt) : 0}ms  max=${tt.length ? Math.max(...tt) : 0}ms${failStr}`
      );
    }
  }

  // Show failures
  const failures = results.filter(r => !r.ok);
  if (failures.length > 0) {
    console.log(`\n  ${C.red}Failures:${C.reset}`);
    for (const f of failures) {
      console.log(`    #${f.index} ${f.tool}: ${f.error} (${f.elapsedMs}ms)`);
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  console.log('');
  process.stdout.write(`  Stopping skill... `);
  try {
    await stopSkill(SKILL_ID);
    console.log(`${C.green}OK${C.reset}`);
  } catch (e: any) {
    console.log(`${C.red}${e.message}${C.reset}`);
  }

  console.log(
    `\n${passed === COUNT ? C.green : C.yellow}${C.bold}  Done: ${passed}/${COUNT} passed.${C.reset}\n`
  );
  process.exit(failed > 0 ? 1 : 0);
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const s = [...sorted].sort((a, b) => a - b);
  const idx = Math.ceil((pct / 100) * s.length) - 1;
  return s[Math.max(0, idx)];
}

main().catch(e => {
  console.error(`\n${C.red}Fatal: ${e.message}${C.reset}`);
  process.exit(1);
});
