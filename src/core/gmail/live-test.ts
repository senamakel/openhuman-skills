#!/usr/bin/env npx tsx

/**
 * Gmail skill live integration script.
 *
 * Interactive sequential script that walks through the full skill lifecycle:
 *   start → authenticate → verify connection → exercise tools → verify sync
 *
 * Env vars (required):
 *   JWT_TOKEN       — session JWT from the OpenHuman backend
 *   BACKEND_URL     — backend API base (default: https://api.tinyhumans.ai)
 *
 * Reads .env from the repo root automatically (JWT_TOKEN, BACKEND_URL, etc.).
 *
 * Usage:
 *   npx tsx src/core/gmail/live-test.ts
 */
import * as readline from 'readline';
import { exec } from 'child_process';
import 'dotenv/config';

import {
  authComplete,
  callToolRaw,
  getSkillStatus,
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
  console.log(`\n${C.cyan}${'─'.repeat(60)}${C.reset}`);
  console.log(`${C.cyan}  ${text}${C.reset}`);
  console.log(`${C.cyan}${'─'.repeat(60)}${C.reset}`);
}

function step(label: string) {
  process.stdout.write(`${C.blue}  ▸ ${label}${C.reset} `);
}

function ok(detail?: string) {
  console.log(`${C.green}✓${C.reset}${detail ? ` ${C.dim}${detail}${C.reset}` : ''}`);
}

function fail(detail: string) {
  console.log(`${C.red}✗ ${detail}${C.reset}`);
}

function info(label: string, value: unknown) {
  console.log(`${C.dim}    ${label}: ${C.reset}${value}`);
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` ${C.dim}[${defaultValue}]${C.reset}` : '';
  return new Promise(resolve => {
    rl.question(`${C.yellow}  ? ${question}${suffix}: ${C.reset}`, answer => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function promptSecret(question: string): Promise<string> {
  return new Promise(resolve => {
    process.stdout.write(`${C.yellow}  ? ${question}: ${C.reset}`);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    let input = '';
    const onData = (ch: Buffer) => {
      const c = ch.toString();
      if (c === '\n' || c === '\r') {
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        stdin.removeListener('data', onData);
        console.log();
        resolve(input.trim());
      } else if (c === '\x7f' || c === '\b') {
        input = input.slice(0, -1);
      } else if (c === '\x03') {
        process.exit(1);
      } else {
        input += c;
      }
    };
    stdin.on('data', onData);
  });
}

/** Open a URL in the default browser. */
function openUrl(url: string) {
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, err => {
    if (err) console.warn(`${C.dim}    (could not open browser: ${err.message})${C.reset}`);
  });
}

// ---------------------------------------------------------------------------
// Tool caller
// ---------------------------------------------------------------------------

const SKILL_ID = 'gmail';

async function callToolSafe(
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<{ data?: any; error?: string }> {
  try {
    const result = await callToolRaw(SKILL_ID, toolName, args, 60_000);
    if (result.is_error) {
      return { error: result.content?.[0]?.text || 'unknown error' };
    }
    const text = result.content?.[0]?.text;
    if (!text) return { data: null };
    try {
      return { data: JSON.parse(text) };
    } catch {
      return { data: text };
    }
  } catch (e: any) {
    return { error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Config from env
// ---------------------------------------------------------------------------

const JWT_TOKEN = process.env.JWT_TOKEN || '';
const BACKEND_URL = (process.env.BACKEND_URL || 'https://api.tinyhumans.ai').replace(/\/+$/, '');

// Pre-filled credentials from env — if all are set, skip interactive prompts.
// AUTH_MODE: "oauth" (default) or "self_hosted"
// For oauth:       GMAIL_INTEGRATION_ID + GMAIL_CLIENT_KEY_SHARE
// For self_hosted: GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN
const ENV_AUTH_MODE = process.env.AUTH_MODE || '';
const ENV_INTEGRATION_ID = process.env.GMAIL_INTEGRATION_ID || '';
const ENV_CLIENT_KEY = process.env.GMAIL_CLIENT_KEY_SHARE || '';
const ENV_CLIENT_ID = process.env.GMAIL_CLIENT_ID || '';
const ENV_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || '';
const ENV_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN || '';

if (!JWT_TOKEN) {
  console.error(`\n${C.red}  JWT_TOKEN env var is required.${C.reset}`);
  console.error(`${C.dim}  Usage: JWT_TOKEN=<jwt> npx tsx src/core/gmail/live-test.ts${C.reset}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n${C.bold}  Gmail Skill — Live Integration Script${C.reset}`);
  info('Backend', BACKEND_URL);
  info('JWT', `<${JWT_TOKEN.length} chars>`);

  // ── Resolve credentials (env or interactive) ─────────────────────────────

  let mode: 'self_hosted' | 'encrypted_oauth';
  let clientId = '';
  let clientSecret = '';
  let refreshToken = '';
  let integrationId = '';
  let clientKeyShare = '';

  const hasOAuthEnv = !!(ENV_INTEGRATION_ID && ENV_CLIENT_KEY);
  const hasSelfHostedEnv = !!(ENV_CLIENT_ID && ENV_CLIENT_SECRET && ENV_REFRESH_TOKEN);

  if (hasOAuthEnv || (ENV_AUTH_MODE === 'oauth' && hasOAuthEnv)) {
    // All OAuth credentials provided via env — skip prompts entirely
    mode = 'encrypted_oauth';
    integrationId = ENV_INTEGRATION_ID;
    clientKeyShare = ENV_CLIENT_KEY;

    header('1. Credentials (from env)');
    info('Mode', 'encrypted_oauth');
    info('Integration ID', integrationId);
    info('Client key', `<${clientKeyShare.length} chars>`);
  } else if (hasSelfHostedEnv || ENV_AUTH_MODE === 'self_hosted') {
    // Self-hosted credentials provided via env
    mode = 'self_hosted';
    clientId = ENV_CLIENT_ID;
    clientSecret = ENV_CLIENT_SECRET;
    refreshToken = ENV_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      header('1. Credentials');
      clientId = clientId || (await prompt('Google Client ID'));
      clientSecret = clientSecret || (await promptSecret('Google Client Secret'));
      refreshToken = refreshToken || (await promptSecret('Refresh Token'));
      if (!clientId || !clientSecret || !refreshToken) {
        fail('All three fields are required.');
        process.exit(1);
      }
    } else {
      header('1. Credentials (from env)');
    }
    info('Mode', 'self_hosted');
    info('Client ID', `${clientId.slice(0, 12)}...`);
  } else {
    // Nothing in env — interactive mode
    header('1. Authentication Mode');

    const choice = await prompt(
      'Auth mode — (1) Encrypted OAuth via browser  (2) Own OAuth credentials',
      '1'
    );
    mode = choice === '2' ? 'self_hosted' : 'encrypted_oauth';

    if (mode === 'self_hosted') {
      clientId = await prompt('Google Client ID');
      clientSecret = await promptSecret('Google Client Secret');
      refreshToken = await promptSecret('Refresh Token');
      if (!clientId || !clientSecret || !refreshToken) {
        fail('All three fields are required.');
        process.exit(1);
      }
    } else {
      // ── Initiate OAuth via browser ─────────────────────────────────────

      header('2. OAuth Flow');

      step('Requesting OAuth URL from backend...');
      const connectUrl = `${BACKEND_URL}/auth/gmail/connect?skillId=gmail&responseType=json&encryptionMode=encrypted`;
      const connectResp = await fetch(connectUrl, {
        headers: { Authorization: `Bearer ${JWT_TOKEN}` },
      });
      if (!connectResp.ok) {
        const text = await connectResp.text();
        fail(`Backend returned ${connectResp.status}: ${text}`);
        process.exit(1);
      }
      const connectData = (await connectResp.json()) as { oauthUrl?: string; success?: boolean };
      const oauthUrl = connectData.oauthUrl;
      if (!oauthUrl) {
        fail(`No oauthUrl in response: ${JSON.stringify(connectData)}`);
        process.exit(1);
      }
      ok();

      console.log(`\n${C.yellow}  Opening Google OAuth page in your browser...${C.reset}`);
      console.log(`${C.dim}  If it doesn't open, visit this URL manually:${C.reset}`);
      console.log(`${C.dim}  ${oauthUrl}${C.reset}\n`);
      openUrl(oauthUrl);

      console.log(
        `${C.yellow}  After authorizing, the backend will return a JSON response.${C.reset}`
      );
      console.log(`${C.yellow}  Copy the integrationId and clientKey from it.${C.reset}\n`);

      integrationId = await prompt('Integration ID (24-char hex from callback)');
      clientKeyShare = await promptSecret('Client key share (base64 from callback)');

      if (!integrationId || !clientKeyShare) {
        fail('Both integration ID and client key share are required.');
        process.exit(1);
      }
    }
  }

  // ── Start skill ──────────────────────────────────────────────────────────

  header('3. Start Skill');

  step('Stopping any existing instance...');
  try {
    await stopSkill(SKILL_ID);
    ok();
  } catch {
    ok('(was not running)');
  }

  step('Starting gmail skill...');
  try {
    const snap = await startSkill(SKILL_ID);
    ok(`status=${snap.status}, tools=${snap.tools.length}`);
  } catch (e: any) {
    fail(e.message);
    process.exit(1);
  }

  // ── Authenticate ─────────────────────────────────────────────────────────

  header('4. Authenticate');

  if (mode === 'self_hosted') {
    step('Sending auth/complete with self-hosted credentials...');
    try {
      const result = (await authComplete(SKILL_ID, 'self_hosted', {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      })) as any;
      if (result.status === 'complete') {
        ok(result.message || '');
      } else {
        fail(JSON.stringify(result.errors || result));
        process.exit(1);
      }
    } catch (e: any) {
      fail(e.message);
      process.exit(1);
    }
  } else {
    step('Sending oauth/complete with encrypted credential...');
    try {
      const result = await oauthComplete(SKILL_ID, {
        credentialId: integrationId,
        provider: 'gmail',
        grantedScopes: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/gmail.labels',
        ],
        clientKeyShare,
      });
      ok(JSON.stringify(result).slice(0, 120));
    } catch (e: any) {
      fail(e.message);
      process.exit(1);
    }
  }

  step('Marking setup complete...');
  try {
    await setSetupComplete(SKILL_ID, true);
    ok();
  } catch (e: any) {
    fail(e.message);
  }

  // ── Verify connection ────────────────────────────────────────────────────

  header('5. Verify Connection');

  step('Waiting for state to settle...');
  await new Promise(r => setTimeout(r, 1500));
  ok();

  step('Checking skill status...');
  try {
    const snap = await getSkillStatus(SKILL_ID);
    const s = snap.state as Record<string, unknown> | undefined;
    info('connection_status', s?.connection_status ?? '(none)');
    info('auth_status', s?.auth_status ?? '(none)');
    info('userEmail', s?.userEmail ?? '(none)');
    if (s?.connection_status === 'connected') ok('connected');
    else fail(`Expected connected, got ${s?.connection_status}`);
  } catch (e: any) {
    fail(e.message);
  }

  // ── Exercise tools ───────────────────────────────────────────────────────

  header('6. Exercise Tools');

  step('get-profile...');
  {
    const { data, error } = await callToolSafe('get-profile', {});
    if (error) fail(error);
    else ok(String(data?.emailAddress || data?.email || JSON.stringify(data).slice(0, 80)));
  }

  step('get-labels...');
  {
    const { data, error } = await callToolSafe('get-labels', {});
    if (error) fail(error);
    else {
      const labels = data?.labels || [];
      ok(`${labels.length} labels`);
      for (const l of labels.slice(0, 5)) info('label', l.name || l.id);
      if (labels.length > 5) info('', `...and ${labels.length - 5} more`);
    }
  }

  step('get-emails (max 5)...');
  {
    const { data, error } = await callToolSafe('get-emails', { max_results: 5 });
    if (error) fail(error);
    else {
      const emails = data?.emails || data?.messages || [];
      ok(`${emails.length} emails`);
      for (const e of emails.slice(0, 3)) info('email', `${e.subject || e.id} — ${e.from || ''}`);
    }
  }

  step('search-emails (in:inbox, max 3)...');
  {
    const { data, error } = await callToolSafe('search-emails', {
      query: 'in:inbox',
      max_results: 3,
    });
    if (error) fail(error);
    else ok(`${(data?.emails || data?.messages || []).length} results`);
  }

  // ── Verify sync (auto-triggered by Rust runtime after auth) ─────────────

  header('7. Verify Sync');

  step('Waiting for auto-sync to complete...');
  await new Promise(r => setTimeout(r, 5000));
  ok();

  step('Checking post-sync state...');
  try {
    const snap = await getSkillStatus(SKILL_ID);
    const s = snap.state as Record<string, unknown> | undefined;
    info('userEmail', s?.userEmail ?? 'N/A');
    info('totalEmails', s?.totalEmails ?? 'N/A');
    info('lastSyncTime', s?.lastSyncTime ?? 'N/A');
    info('syncInProgress', s?.syncInProgress ?? 'N/A');
    ok();
  } catch (e: any) {
    fail(e.message);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  header('8. Cleanup');

  step('Stopping skill...');
  try {
    await stopSkill(SKILL_ID);
    ok();
  } catch (e: any) {
    fail(e.message);
  }

  console.log(`\n${C.green}${C.bold}  Done.${C.reset}\n`);
  rl.close();
  process.exit(0);
}

main().catch(e => {
  console.error(`\n${C.red}Fatal: ${e.message}${C.reset}`);
  rl.close();
  process.exit(1);
});
