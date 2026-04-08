/**
 * Tests for the server-ping skill.
 * Runs against the real Rust QuickJS runtime via JSON-RPC.
 */
import {
  afterAll,
  assert,
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  beforeAll,
  callTool,
  callToolRaw,
  describe,
  getSkillStatus,
  it,
  run,
  setupStart,
  setupSubmit,
  skillRpc,
  startSkill,
  stopSkill,
} from '../../../../dev/test-harness';

const SKILL_ID = 'server-ping';

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Lifecycle', () => {
  it('should start successfully', async () => {
    const snap = await startSkill(SKILL_ID);
    assertEqual(snap.status, 'running');
    assertNotNull(snap.name);
  });

  it('should register tools on start', async () => {
    const snap = await getSkillStatus(SKILL_ID);
    assertGreaterThan(snap.tools.length, 0, 'should have tools');
    const toolNames = snap.tools.map(t => t.name);
    assertContains(toolNames.join(','), 'get-ping-stats');
    assertContains(toolNames.join(','), 'get-ping-history');
    assertContains(toolNames.join(','), 'ping-now');
    assertContains(toolNames.join(','), 'update-server-url');
    assertContains(toolNames.join(','), 'list-peer-skills');
    assertContains(toolNames.join(','), 'read-config');
  });

  it('should stop cleanly', async () => {
    await stopSkill(SKILL_ID);
    // Restarting should work after stop
    const snap = await startSkill(SKILL_ID);
    assertEqual(snap.status, 'running');
  });

  afterAll(async () => {
    try {
      await stopSkill(SKILL_ID);
    } catch {}
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Setup flow tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Setup flow', () => {
  beforeAll(async () => {
    try {
      await stopSkill(SKILL_ID);
    } catch {}
    await startSkill(SKILL_ID);
  });

  it('onSetupStart should return server-config step', async () => {
    const result = (await setupStart(SKILL_ID)) as any;
    assertNotNull(result);
    assertNotNull(result.step);
    assertEqual(result.step.id, 'server-config');
    assert(result.step.fields.length >= 2, 'should have at least 2 fields');
    const fieldNames = result.step.fields.map((f: any) => f.name);
    assertContains(fieldNames.join(','), 'serverUrl');
    assertContains(fieldNames.join(','), 'pingIntervalSec');
  });

  it('onSetupSubmit should validate empty URL', async () => {
    const result = (await setupSubmit(SKILL_ID, 'server-config', {
      serverUrl: '',
      pingIntervalSec: '10',
    })) as any;
    assertEqual(result.status, 'error');
    assert(result.errors.length > 0, 'should have errors');
    assertEqual(result.errors[0].field, 'serverUrl');
  });

  it('onSetupSubmit should validate URL protocol', async () => {
    const result = (await setupSubmit(SKILL_ID, 'server-config', {
      serverUrl: 'ftp://bad.com',
      pingIntervalSec: '10',
    })) as any;
    assertEqual(result.status, 'error');
  });

  it('onSetupSubmit step 1 should return next step', async () => {
    const result = (await setupSubmit(SKILL_ID, 'server-config', {
      serverUrl: 'http://localhost:7799',
      pingIntervalSec: '30',
    })) as any;
    assertEqual(result.status, 'next');
    assertEqual(result.nextStep.id, 'notification-config');
  });

  it('onSetupSubmit step 2 should complete', async () => {
    // Step 1
    await setupSubmit(SKILL_ID, 'server-config', {
      serverUrl: 'http://localhost:7799',
      pingIntervalSec: '10',
    });
    // Step 2
    const result = (await setupSubmit(SKILL_ID, 'notification-config', {
      notifyOnDown: true,
      notifyOnRecover: false,
    })) as any;
    assertEqual(result.status, 'complete');
  });

  it('onSetupSubmit should error on unknown step', async () => {
    const result = (await setupSubmit(SKILL_ID, 'nonexistent', {})) as any;
    assertEqual(result.status, 'error');
  });

  afterAll(async () => {
    try {
      await stopSkill(SKILL_ID);
    } catch {}
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tools tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Tools', () => {
  beforeAll(async () => {
    try {
      await stopSkill(SKILL_ID);
    } catch {}
    await startSkill(SKILL_ID);
  });

  it('get-ping-stats should return stats object', async () => {
    const stats = (await callTool(SKILL_ID, 'get-ping-stats')) as any;
    assertNotNull(stats);
    assertNotNull(stats.platform, 'should include platform');
    assertEqual(typeof stats.uptimePercent, 'number');
    assertEqual(typeof stats.totalPings, 'number');
    assertEqual(typeof stats.totalFailures, 'number');
  });

  it('get-ping-history should return history', async () => {
    const history = (await callTool(SKILL_ID, 'get-ping-history', { limit: '5' })) as any;
    assertNotNull(history);
    assert(Array.isArray(history.history), 'history should be an array');
    assertEqual(typeof history.count, 'number');
  });

  it('update-server-url should change URL', async () => {
    const result = (await callTool(SKILL_ID, 'update-server-url', {
      url: 'https://new-test.example.com',
    })) as any;
    assertEqual(result.success, true);
    assertEqual(result.newUrl, 'https://new-test.example.com');

    // Verify the change via get-ping-stats
    const stats = (await callTool(SKILL_ID, 'get-ping-stats')) as any;
    assertEqual(stats.serverUrl, 'https://new-test.example.com');
  });

  it('update-server-url should reject invalid URL', async () => {
    const result = (await callTool(SKILL_ID, 'update-server-url', { url: 'not-a-url' })) as any;
    assert(result.error, 'should return error for invalid URL');
  });

  it('ping-now should trigger immediate ping', async () => {
    // First set a valid URL (use the test runtime itself as a reachable target)
    await callTool(SKILL_ID, 'update-server-url', { url: 'http://localhost:7799' });
    const result = (await callTool(SKILL_ID, 'ping-now')) as any;
    assertEqual(result.triggered, true);
    assertGreaterThan(result.pingNumber, 0, 'should have ping number');
    assertNotNull(result.result, 'should return ping result');
  });

  it('list-peer-skills should return skills list', async () => {
    const result = (await callTool(SKILL_ID, 'list-peer-skills')) as any;
    assertNotNull(result);
    assert(Array.isArray(result.skills), 'should return skills array');
  });

  it('read-config should handle missing file gracefully', async () => {
    const result = (await callTool(SKILL_ID, 'read-config')) as any;
    assertNotNull(result);
    // May return error or config depending on whether setup was run
  });

  afterAll(async () => {
    try {
      await stopSkill(SKILL_ID);
    } catch {}
  });
});

// Run all tests
run();
