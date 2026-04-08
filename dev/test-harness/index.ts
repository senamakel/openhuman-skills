/**
 * Unified test harness for OpenHuman skills.
 *
 * Tests run against the **real Rust QuickJS runtime** via JSON-RPC,
 * not Node.js mocks. The runtime is started once per test session
 * and shared across all test files.
 *
 * Usage in test files:
 *
 *   import { describe, it, beforeAll, afterAll, startSkill, stopSkill,
 *            callTool, rpc, assertEqual, assertNotNull } from '../../dev/test-harness';
 *
 *   describe('My Skill', () => {
 *     beforeAll(async () => { await startSkill('my-skill'); });
 *     afterAll(async () => { await stopSkill('my-skill'); });
 *
 *     it('should return stats', async () => {
 *       const result = await callTool('my-skill', 'get-stats');
 *       assertNotNull(result);
 *     });
 *   });
 */

// ---------------------------------------------------------------------------
// RPC Client
// ---------------------------------------------------------------------------

const RUNTIME_URL = process.env.SKILLS_RUNTIME_URL || 'http://127.0.0.1:7799';

let rpcId = 0;

/**
 * Make a JSON-RPC 2.0 call to the skills runtime.
 */
export async function rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const id = ++rpcId;
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });

  const response = await fetch(`${RUNTIME_URL}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const json = (await response.json()) as {
    result?: unknown;
    error?: { code: number; message: string };
  };

  if (json.error) {
    throw new Error(`RPC ${method} failed: ${json.error.message}`);
  }

  return json.result;
}

/**
 * GET a REST endpoint on the skills runtime.
 */
export async function httpGet(path: string): Promise<unknown> {
  const response = await fetch(`${RUNTIME_URL}${path}`);
  return response.json();
}

// ---------------------------------------------------------------------------
// Skill lifecycle helpers
// ---------------------------------------------------------------------------

export interface SkillSnapshot {
  skill_id: string;
  name: string;
  status: string;
  tools: Array<{ name: string; description: string; inputSchema?: unknown }>;
  error?: string;
  state: Record<string, unknown>;
  setup_complete: boolean;
  connection_status: string;
}

export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  is_error: boolean;
}

/**
 * Discover all available skills.
 */
export async function discoverSkills(): Promise<unknown[]> {
  return (await rpc('openhuman.skills_discover')) as unknown[];
}

/**
 * Start a skill by ID. Returns the skill snapshot.
 */
export async function startSkill(skillId: string): Promise<SkillSnapshot> {
  return (await rpc('openhuman.skills_start', { skill_id: skillId })) as SkillSnapshot;
}

/**
 * Stop a running skill.
 */
export async function stopSkill(skillId: string): Promise<void> {
  await rpc('openhuman.skills_stop', { skill_id: skillId });
}

/**
 * Get the status/snapshot of a skill.
 */
export async function getSkillStatus(skillId: string): Promise<SkillSnapshot> {
  return (await rpc('openhuman.skills_status', { skill_id: skillId })) as SkillSnapshot;
}

/**
 * Call a tool on a running skill. Returns the raw ToolResult.
 * Times out after `timeoutMs` (default: 15s) to avoid hanging on network calls.
 */
export async function callToolRaw(
  skillId: string,
  toolName: string,
  args: Record<string, unknown> = {},
  timeoutMs: number = 15000,
): Promise<ToolResult> {
  const rpcPromise = rpc('openhuman.skills_call_tool', {
    skill_id: skillId,
    tool_name: toolName,
    arguments: args,
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Tool call ${skillId}/${toolName} timed out after ${timeoutMs}ms`)), timeoutMs),
  );

  return (await Promise.race([rpcPromise, timeoutPromise])) as ToolResult;
}

/**
 * Call a tool and return the parsed JSON from the first text content block.
 */
export async function callTool(
  skillId: string,
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const result = await callToolRaw(skillId, toolName, args);
  if (result.is_error) {
    const text = result.content?.[0]?.text || 'unknown error';
    throw new Error(`Tool ${skillId}/${toolName} returned error: ${text}`);
  }
  const text = result.content?.[0]?.text;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * List all tools across all running skills.
 */
export async function listAllTools(): Promise<
  Array<{ skill_id: string; name: string; description: string }>
> {
  const data = (await httpGet('/tools')) as { tools: Array<{ skill_id: string; name: string; description: string }> };
  return data.tools;
}

/**
 * List all running skills.
 */
export async function listSkills(): Promise<SkillSnapshot[]> {
  const data = (await httpGet('/skills')) as { skills: SkillSnapshot[] };
  return data.skills;
}

/**
 * Send a generic RPC to a skill (setup/start, setup/submit, setup/cancel, etc.)
 */
export async function skillRpc(
  skillId: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  return rpc('openhuman.skills_rpc', { skill_id: skillId, method, params });
}

/**
 * Begin the setup wizard for a skill.
 */
export async function setupStart(skillId: string): Promise<unknown> {
  return rpc('openhuman.skills_setup_start', { skill_id: skillId });
}

/**
 * Submit a setup step.
 */
export async function setupSubmit(
  skillId: string,
  stepId: string,
  values: Record<string, unknown>,
): Promise<unknown> {
  return skillRpc(skillId, 'setup/submit', { stepId, values });
}

/**
 * Mark a skill's setup as complete.
 */
export async function setSetupComplete(skillId: string, complete: boolean = true): Promise<void> {
  await rpc('openhuman.skills_set_setup_complete', {
    skill_id: skillId,
    complete,
  });
}

/**
 * Complete the auth flow for a skill (self_hosted / text mode).
 * Sends `auth/complete` RPC with mode and credentials.
 */
export async function authComplete(
  skillId: string,
  mode: string,
  credentials: Record<string, unknown>,
): Promise<unknown> {
  return skillRpc(skillId, 'auth/complete', { mode, credentials });
}

/**
 * Complete the OAuth flow for a skill (managed mode).
 * Sends `oauth/complete` RPC with credential info and optional clientKeyShare
 * for encrypted OAuth.
 */
export async function oauthComplete(
  skillId: string,
  args: {
    credentialId: string;
    provider: string;
    grantedScopes?: string[];
    accountLabel?: string;
    clientKeyShare?: string;
  },
): Promise<unknown> {
  return skillRpc(skillId, 'oauth/complete', args);
}

/**
 * Trigger a sync on a running skill.
 * Note: the Rust event loop matches on "skill/sync", not bare "sync".
 */
export async function triggerSync(skillId: string): Promise<unknown> {
  return skillRpc(skillId, 'skill/sync', {});
}

/**
 * Read a file from the skill's data directory.
 */
export async function dataRead(skillId: string, filename: string): Promise<string | null> {
  const result = (await rpc('openhuman.skills_data_read', {
    skill_id: skillId,
    filename,
  })) as { content: string | null };
  return result.content;
}

/**
 * Write a file to the skill's data directory.
 */
export async function dataWrite(skillId: string, filename: string, content: string): Promise<void> {
  await rpc('openhuman.skills_data_write', {
    skill_id: skillId,
    filename,
    content,
  });
}

// ---------------------------------------------------------------------------
// Test framework
// ---------------------------------------------------------------------------

interface TestCase {
  name: string;
  fn: () => Promise<void> | void;
}

interface TestSuite {
  name: string;
  tests: TestCase[];
  beforeAll?: () => Promise<void> | void;
  afterAll?: () => Promise<void> | void;
  beforeEach?: () => Promise<void> | void;
  afterEach?: () => Promise<void> | void;
}

const suites: TestSuite[] = [];
let currentSuite: TestSuite | null = null;

// Result tracking
let passed = 0;
let failed = 0;
const errors: Array<{ suite: string; test: string; error: string }> = [];

/**
 * Define a test suite.
 */
export function describe(name: string, fn: () => void): void {
  const suite: TestSuite = { name, tests: [] };
  currentSuite = suite;
  fn();
  suites.push(suite);
  currentSuite = null;
}

/**
 * Define a test case within a describe block.
 */
export function it(name: string, fn: () => Promise<void> | void): void {
  if (!currentSuite) throw new Error('it() must be called inside describe()');
  currentSuite.tests.push({ name, fn });
}

/**
 * Register a beforeAll hook for the current suite.
 */
export function beforeAll(fn: () => Promise<void> | void): void {
  if (!currentSuite) throw new Error('beforeAll() must be called inside describe()');
  currentSuite.beforeAll = fn;
}

/**
 * Register an afterAll hook for the current suite.
 */
export function afterAll(fn: () => Promise<void> | void): void {
  if (!currentSuite) throw new Error('afterAll() must be called inside describe()');
  currentSuite.afterAll = fn;
}

/**
 * Register a beforeEach hook for the current suite.
 */
export function beforeEach(fn: () => Promise<void> | void): void {
  if (!currentSuite) throw new Error('beforeEach() must be called inside describe()');
  currentSuite.beforeEach = fn;
}

/**
 * Register an afterEach hook for the current suite.
 */
export function afterEach(fn: () => Promise<void> | void): void {
  if (!currentSuite) throw new Error('afterEach() must be called inside describe()');
  currentSuite.afterEach = fn;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

export function assert(condition: unknown, message?: string): void {
  if (!condition) {
    throw new AssertionError(message || 'Assertion failed');
  }
}

export function assertEqual(actual: unknown, expected: unknown, message?: string): void {
  if (actual !== expected) {
    throw new AssertionError(
      message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export function assertNotEqual(actual: unknown, expected: unknown, message?: string): void {
  if (actual === expected) {
    throw new AssertionError(
      message || `Expected value to not equal ${JSON.stringify(expected)}`,
    );
  }
}

export function assertNotNull(value: unknown, message?: string): void {
  if (value === null || value === undefined) {
    throw new AssertionError(message || 'Expected non-null value');
  }
}

export function assertNull(value: unknown, message?: string): void {
  if (value !== null && value !== undefined) {
    throw new AssertionError(message || `Expected null, got ${JSON.stringify(value)}`);
  }
}

export function assertTrue(value: unknown, message?: string): void {
  if (value !== true) {
    throw new AssertionError(message || `Expected true, got ${JSON.stringify(value)}`);
  }
}

export function assertFalse(value: unknown, message?: string): void {
  if (value !== false) {
    throw new AssertionError(message || `Expected false, got ${JSON.stringify(value)}`);
  }
}

export function assertContains(haystack: string, needle: string, message?: string): void {
  if (!haystack.includes(needle)) {
    throw new AssertionError(
      message || `Expected "${haystack}" to contain "${needle}"`,
    );
  }
}

export function assertGreaterThan(a: number, b: number, message?: string): void {
  if (!(a > b)) {
    throw new AssertionError(message || `Expected ${a} > ${b}`);
  }
}

export function assertDeepEqual(actual: unknown, expected: unknown, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new AssertionError(
      message ||
        `Deep equality failed:\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`,
    );
  }
}

export function assertThrows(fn: () => void, expectedMsg?: string, message?: string): void {
  let threw = false;
  try {
    fn();
  } catch (e: unknown) {
    threw = true;
    if (expectedMsg) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes(expectedMsg)) {
        throw new AssertionError(
          message || `Expected error containing "${expectedMsg}", got "${msg}"`,
        );
      }
    }
  }
  if (!threw) {
    throw new AssertionError(message || 'Expected function to throw');
  }
}

export function assertMatch(str: string, regex: RegExp, message?: string): void {
  if (!regex.test(str)) {
    throw new AssertionError(message || `Expected "${str}" to match ${regex}`);
  }
}

export function assertArrayLength(arr: unknown[], len: number, message?: string): void {
  if (arr.length !== len) {
    throw new AssertionError(
      message || `Expected array length ${len}, got ${arr.length}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

/**
 * Run all registered test suites. Called automatically at the end of a test file.
 * Returns the exit code (0 = all passed, 1 = failures).
 */
export async function runTests(): Promise<number> {
  for (const suite of suites) {
    console.log(`\n${colors.cyan}  ${suite.name}${colors.reset}`);

    try {
      if (suite.beforeAll) await suite.beforeAll();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`    ${colors.red}beforeAll FAILED: ${msg}${colors.reset}`);
      for (const test of suite.tests) {
        failed++;
        errors.push({ suite: suite.name, test: test.name, error: `beforeAll failed: ${msg}` });
      }
      continue;
    }

    for (const test of suite.tests) {
      try {
        if (suite.beforeEach) await suite.beforeEach();
        await test.fn();
        if (suite.afterEach) await suite.afterEach();
        passed++;
        console.log(`    ${colors.green}\u2713${colors.reset} ${test.name}`);
      } catch (e: unknown) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        errors.push({ suite: suite.name, test: test.name, error: msg });
        console.log(`    ${colors.red}\u2717 ${test.name}${colors.reset}`);
        console.log(`      ${colors.dim}${msg}${colors.reset}`);
      }
    }

    try {
      if (suite.afterAll) await suite.afterAll();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`    ${colors.yellow}afterAll error: ${msg}${colors.reset}`);
    }
  }

  // Summary
  console.log(`\n  ${colors.green}${passed} passed${colors.reset}, ${failed > 0 ? colors.red : colors.dim}${failed} failed${colors.reset}\n`);

  if (errors.length > 0) {
    console.log(`${colors.red}  Failures:${colors.reset}`);
    for (const err of errors) {
      console.log(`    ${err.suite} > ${err.test}`);
      console.log(`      ${colors.dim}${err.error}${colors.reset}`);
    }
    console.log();
  }

  return failed > 0 ? 1 : 0;
}

/**
 * Auto-run tests when this module is imported as main.
 * Test files should call this at the end.
 */
export async function run(): Promise<void> {
  const code = await runTests();
  process.exit(code);
}
