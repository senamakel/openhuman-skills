#!/usr/bin/env node
/**
 * dev-runtime.mjs — starts the skills runtime with .env loaded.
 *
 * Loads .env from the repo root, then spawns the openhuman-core binary
 * with all env vars forwarded so skills can read BACKEND_URL, JWT_TOKEN, etc.
 *
 * Usage:
 *   node scripts/dev-runtime.mjs
 *   node scripts/dev-runtime.mjs --port 7799
 */

import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Load .env
// ---------------------------------------------------------------------------

const envFile = resolve(rootDir, '.env');
const envVars = { ...process.env };

if (existsSync(envFile)) {
  const lines = readFileSync(envFile, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    // Don't override vars already set in the shell
    if (!process.env[key] && value) {
      envVars[key] = value;
    }
  }
  console.log(`\x1b[2m  Loaded .env from ${envFile}\x1b[0m`);
} else {
  console.log(`\x1b[33m  No .env file found at ${envFile}\x1b[0m`);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let port = 7799;
const portIdx = args.indexOf('--port');
if (portIdx !== -1 && args[portIdx + 1]) {
  port = parseInt(args[portIdx + 1], 10);
}

const SKILLS_DIR = resolve(rootDir, 'skills');
const CORE_BINARY = resolve(rootDir, 'openhuman', 'target', 'debug', 'openhuman-core');

// ---------------------------------------------------------------------------
// Build skills and runtime
// ---------------------------------------------------------------------------

console.log(`\x1b[36m  Building skills...\x1b[0m`);
try {
  execSync('yarn build', { cwd: rootDir, stdio: 'inherit' });
  console.log(`\x1b[32m  Skills build complete.\x1b[0m\n`);
} catch (err) {
  console.error(`\x1b[31m  Skills build failed.\x1b[0m`);
  process.exit(1);
}

console.log(`\x1b[36m  Building runtime (cargo build)...\x1b[0m`);
try {
  execSync('cargo build', { cwd: resolve(rootDir, 'openhuman'), stdio: 'inherit' });
  console.log(`\x1b[32m  Runtime build complete.\x1b[0m\n`);
} catch (err) {
  console.error(`\x1b[31m  Runtime build failed.\x1b[0m`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Post-build checks
// ---------------------------------------------------------------------------

if (!existsSync(CORE_BINARY)) {
  console.error(`\x1b[31m  Error: openhuman-core binary not found at ${CORE_BINARY}\x1b[0m`);
  process.exit(1);
}

if (!existsSync(SKILLS_DIR)) {
  console.error(`\x1b[31m  Error: compiled skills not found at ${SKILLS_DIR}\x1b[0m`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Kill existing process on the port
// ---------------------------------------------------------------------------

try {
  execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 500));
} catch {
  // Nothing running on that port
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

console.log(`\n\x1b[36m  Skills Runtime (dev)\x1b[0m`);
console.log(`\x1b[2m  Port:        ${port}\x1b[0m`);
console.log(`\x1b[2m  Skills dir:  ${SKILLS_DIR}\x1b[0m`);
console.log(`\x1b[2m  Backend:     ${envVars.BACKEND_URL || '(not set — will use default)'}\x1b[0m`);
console.log(`\x1b[2m  JWT:         ${envVars.JWT_TOKEN ? `<${envVars.JWT_TOKEN.length} chars>` : '(not set)'}\x1b[0m`);
console.log();

const child = spawn(CORE_BINARY, [
  'skills', 'run',
  '--skills-dir', SKILLS_DIR,
  '--port', String(port),
], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: {
    ...envVars,
    RUST_LOG: envVars.RUST_LOG || 'info',
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

// Forward signals for clean shutdown
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
