#!/usr/bin/env node
/**
 * test-runner.mjs — unified test runner for OpenHuman skills.
 *
 * 1. Starts the Rust skills runtime (openhuman-core skills run)
 * 2. Waits for it to be healthy
 * 3. Runs each test file via tsx
 * 4. Reports results and shuts down the runtime
 *
 * Usage:
 *   node scripts/test-runner.mjs                           # run all tests
 *   node scripts/test-runner.mjs src/core/server-ping      # test one skill
 *   node scripts/test-runner.mjs src/core/server-ping/__tests__/test-server-ping.ts
 */

import { spawn, execSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RUNTIME_PORT = 7799;
const RUNTIME_URL = `http://127.0.0.1:${RUNTIME_PORT}`;
const SKILLS_DIR = join(rootDir, 'skills');
const SRC_DIR = join(rootDir, 'src');

// Path to the pre-built binary (cargo build must have been run already)
const CORE_BINARY = join(rootDir, 'openhuman', 'target', 'debug', 'openhuman-core');

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for the runtime health endpoint to respond. */
async function waitForRuntime(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${RUNTIME_URL}/health`);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** Find all test files matching the pattern. */
function discoverTestFiles(filter) {
  const files = [];

  if (filter) {
    // If filter is a direct .ts file path
    if (filter.endsWith('.ts') && existsSync(join(rootDir, filter))) {
      return [join(rootDir, filter)];
    }

    // If filter is a skill directory path (e.g. src/core/server-ping)
    const skillTestDir = join(rootDir, filter, '__tests__');
    if (existsSync(skillTestDir)) {
      for (const f of readdirSync(skillTestDir)) {
        if (f.startsWith('test-') && f.endsWith('.ts')) {
          files.push(join(skillTestDir, f));
        }
      }
      return files;
    }

    // If filter is a skill ID (e.g. server-ping)
    const coreTestDir = join(SRC_DIR, 'core', filter, '__tests__');
    if (existsSync(coreTestDir)) {
      for (const f of readdirSync(coreTestDir)) {
        if (f.startsWith('test-') && f.endsWith('.ts')) {
          files.push(join(coreTestDir, f));
        }
      }
      return files;
    }
  }

  // Discover test files under src/core/ (skip src/old/ and other non-core dirs)
  const CORE_DIR = join(SRC_DIR, 'core');
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === '__tests__') {
          for (const f of readdirSync(full)) {
            if (f.startsWith('test-') && f.endsWith('.ts')) {
              files.push(join(full, f));
            }
          }
        } else if (entry !== 'node_modules' && entry !== '.git') {
          walk(full);
        }
      }
    }
  }

  walk(CORE_DIR);
  return files;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const filter = process.argv[2];

  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}       OpenHuman Skills Test Runner (Rust Runtime)         ${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log();

  // 1. Check prerequisites
  if (!existsSync(CORE_BINARY)) {
    console.log(`${colors.red}Error: openhuman-core binary not found at ${CORE_BINARY}${colors.reset}`);
    console.log(`Run: yarn core:build`);
    process.exit(1);
  }

  if (!existsSync(SKILLS_DIR)) {
    console.log(`${colors.red}Error: compiled skills not found at ${SKILLS_DIR}${colors.reset}`);
    console.log(`Run: yarn build`);
    process.exit(1);
  }

  // 2. Discover test files
  const testFiles = discoverTestFiles(filter);
  if (testFiles.length === 0) {
    console.log(`${colors.yellow}No test files found.${colors.reset}`);
    process.exit(0);
  }

  console.log(`${colors.dim}Found ${testFiles.length} test file(s):${colors.reset}`);
  for (const f of testFiles) {
    const rel = f.replace(rootDir + '/', '');
    console.log(`  ${colors.dim}${rel}${colors.reset}`);
  }
  console.log();

  // 3. Kill any existing process on the port
  try {
    execSync(`lsof -ti:${RUNTIME_PORT} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 500));
  } catch {
    // No process to kill — that's fine
  }

  // Start the Rust runtime
  console.log(`${colors.blue}Starting skills runtime on port ${RUNTIME_PORT}...${colors.reset}`);

  const runtimeProcess = spawn(CORE_BINARY, [
    'skills', 'run',
    '--skills-dir', SKILLS_DIR,
    '--port', String(RUNTIME_PORT),
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      RUST_LOG: process.env.RUST_LOG || 'warn',
    },
  });

  // Collect stderr for diagnostics
  let runtimeStderr = '';
  runtimeProcess.stderr.on('data', (chunk) => {
    runtimeStderr += chunk.toString();
  });

  // Handle runtime crash
  let runtimeExited = false;
  runtimeProcess.on('exit', (code) => {
    runtimeExited = true;
    if (code !== null && code !== 0) {
      console.error(`${colors.red}Runtime exited with code ${code}${colors.reset}`);
      if (runtimeStderr) {
        console.error(runtimeStderr.slice(-500));
      }
    }
  });

  // 4. Wait for runtime to be healthy
  const ready = await waitForRuntime(30000);
  if (!ready) {
    console.error(`${colors.red}Runtime failed to start within 30s${colors.reset}`);
    if (runtimeStderr) {
      console.error(runtimeStderr.slice(-1000));
    }
    runtimeProcess.kill('SIGTERM');
    process.exit(1);
  }

  console.log(`${colors.green}Runtime is ready.${colors.reset}\n`);

  // 5. Run each test file
  let totalPassed = 0;
  let totalFailed = 0;
  const failedFiles = [];

  for (const testFile of testFiles) {
    const rel = testFile.replace(rootDir + '/', '');
    console.log(`${colors.bold}${rel}${colors.reset}`);

    try {
      const result = await runTestFile(testFile);
      totalPassed += result.passed;
      totalFailed += result.failed;
      if (result.failed > 0) {
        failedFiles.push(rel);
      }
    } catch (e) {
      totalFailed++;
      failedFiles.push(rel);
      console.log(`  ${colors.red}CRASH: ${e.message}${colors.reset}`);
    }
  }

  // 6. Shutdown runtime
  if (!runtimeExited) {
    runtimeProcess.kill('SIGTERM');
    // Give it a moment to shut down gracefully
    await new Promise((r) => setTimeout(r, 500));
    if (!runtimeExited) {
      runtimeProcess.kill('SIGKILL');
    }
  }

  // 7. Summary
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`  ${colors.green}${totalPassed} passed${colors.reset}, ${totalFailed > 0 ? colors.red : colors.dim}${totalFailed} failed${colors.reset}`);
  if (failedFiles.length > 0) {
    console.log(`\n  ${colors.red}Failed files:${colors.reset}`);
    for (const f of failedFiles) {
      console.log(`    ${f}`);
    }
  }
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

/**
 * Run a single test file via tsx. Parses the output to count passes/failures.
 */
function runTestFile(testFile) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', testFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: rootDir,
      env: {
        ...process.env,
        SKILLS_RUNTIME_URL: RUNTIME_URL,
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('exit', (code) => {
      // Count pass/fail from output
      const passMatch = stdout.match(/(\d+) passed/);
      const failMatch = stdout.match(/(\d+) failed/);
      const passed = passMatch ? parseInt(passMatch[1]) : 0;
      const failed = failMatch ? parseInt(failMatch[1]) : (code !== 0 ? 1 : 0);

      resolve({ passed, failed, code });
    });
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
