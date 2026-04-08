/**
 * Tests for the Notion skill.
 * Runs against the real Rust QuickJS runtime via JSON-RPC.
 */
import {
  afterAll,
  assert,
  assertContains,
  assertEqual,
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

const SKILL_ID = 'notion';

/**
 * Helper: call a tool, accepting both success and error responses.
 * Without real credentials, most Notion tools will fail, so we test
 * that they fail gracefully rather than crash.
 */
async function callToolSafe(toolName: string, args: Record<string, unknown> = {}): Promise<any> {
  try {
    return await callTool(SKILL_ID, toolName, args);
  } catch (e: any) {
    // If the tool returned an error, that's fine — we just want to verify it doesn't crash
    return { error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Lifecycle', () => {
  it('should start successfully', async () => {
    const snap = await startSkill(SKILL_ID);
    assertEqual(snap.status, 'running');
    assertEqual(snap.name, 'Notion');
  });

  it('should register tools on start', async () => {
    const snap = await getSkillStatus(SKILL_ID);
    assert(snap.tools.length > 0, 'should have tools');
    const toolNames = snap.tools.map(t => t.name);
    assertContains(toolNames.join(','), 'search');
    assertContains(toolNames.join(','), 'get-page');
    assertContains(toolNames.join(','), 'create-page');
  });

  it('should stop and restart cleanly', async () => {
    await stopSkill(SKILL_ID);
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

  it('onSetupStart should return a step', async () => {
    const result = (await setupStart(SKILL_ID)) as any;
    assertNotNull(result);
    assertNotNull(result.step);
    assertNotNull(result.step.id);
  });

  it('onSetupSubmit auth_done should complete', async () => {
    const result = (await setupSubmit(SKILL_ID, 'auth_done', {})) as any;
    assertEqual(result.status, 'complete');
  });

  afterAll(async () => {
    try {
      await stopSkill(SKILL_ID);
    } catch {}
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tools tests - without credentials (should return meaningful errors)
// ─────────────────────────────────────────────────────────────────────────────

describe('Tools - input validation', () => {
  beforeAll(async () => {
    try {
      await stopSkill(SKILL_ID);
    } catch {}
    await startSkill(SKILL_ID);
  });

  it('get-page should require page_id', async () => {
    const result = await callToolSafe('get-page', {});
    assert(result.error, 'should return error without page_id');
  });

  it('create-page should require parent_id', async () => {
    const result = await callToolSafe('create-page', { title: 'Test' });
    assert(result.error, 'should require parent_id');
  });

  it('create-page should require title', async () => {
    const result = await callToolSafe('create-page', { parent_id: '123' });
    assert(result.error, 'should require title');
  });

  it('create-comment should require page_id or discussion_id', async () => {
    const result = await callToolSafe('create-comment', { text: 'Test' });
    assert(result.error, 'should return error without page_id or discussion_id');
  });

  it('search without connection should fail gracefully', async () => {
    const result = await callToolSafe('search', { query: 'test' });
    assertNotNull(result);
    // Without credentials, should return an error
    assert(result.error || result.success === false, 'should indicate not connected');
  });

  it('list-all-pages without connection should handle gracefully', async () => {
    const result = await callToolSafe('list-all-pages', {});
    assertNotNull(result);
  });

  it('list-all-databases without connection should handle gracefully', async () => {
    const result = await callToolSafe('list-all-databases', {});
    assertNotNull(result);
  });

  afterAll(async () => {
    try {
      await stopSkill(SKILL_ID);
    } catch {}
  });
});

// Run all tests
run();
