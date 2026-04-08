/**
 * Tests for the Gmail skill.
 * Runs against the real Rust QuickJS runtime via JSON-RPC.
 */
import {
  afterAll,
  assert,
  assertEqual,
  assertFalse,
  assertNotNull,
  assertTrue,
  beforeAll,
  callTool,
  callToolRaw,
  describe,
  getSkillStatus,
  it,
  run,
  setupStart,
  skillRpc,
  startSkill,
  stopSkill,
} from '../../../../dev/test-harness';

const SKILL_ID = 'gmail';

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Lifecycle', () => {
  it('should start successfully', () => {
    const snap = startSkill(SKILL_ID);
    assertEqual(snap.status, 'running');
    assertNotNull(snap.name);
    assertEqual(snap.name, 'Gmail');
  });

  it('should register tools on start', () => {
    const snap = getSkillStatus(SKILL_ID);
    assert(snap.tools.length > 0, 'should have tools');
    const toolNames = snap.tools.map(t => t.name);
    // Gmail should have email-related tools
    assert(
      toolNames.some(n => n.includes('email') || n.includes('label')),
      `should have email/label tools, got: ${toolNames.join(', ')}`
    );
  });

  it('should stop cleanly', () => {
    stopSkill(SKILL_ID);
    // Restarting should work
    const snap = startSkill(SKILL_ID);
    assertEqual(snap.status, 'running');
  });

  afterAll(() => {
    try {
      stopSkill(SKILL_ID);
    } catch {}
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Setup flow tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Setup flow', () => {
  beforeAll(() => {
    try {
      stopSkill(SKILL_ID);
    } catch {}
    startSkill(SKILL_ID);
  });

  it('onSetupStart should return a setup step', () => {
    const result = setupStart(SKILL_ID) as any;
    assertNotNull(result);
    assertNotNull(result.step);
    assertNotNull(result.step.id);
    assertNotNull(result.step.fields);
  });

  afterAll(() => {
    try {
      stopSkill(SKILL_ID);
    } catch {}
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tools tests (without OAuth - tools should return meaningful errors)
// ─────────────────────────────────────────────────────────────────────────────

describe('Tools - without credentials', () => {
  beforeAll(() => {
    try {
      stopSkill(SKILL_ID);
    } catch {}
    startSkill(SKILL_ID);
  });

  it('get-labels should handle missing credentials', () => {
    const result = callTool(SKILL_ID, 'get-labels') as any;
    assertNotNull(result);
    // Without OAuth, should return an error or empty result
    assert(
      result.error || result.success === false || Array.isArray(result.labels),
      'should handle missing credentials gracefully'
    );
  });

  it('get-emails should handle missing credentials', () => {
    const result = callTool(SKILL_ID, 'get-emails') as any;
    assertNotNull(result);
    assert(
      result.error || result.success === false || Array.isArray(result.emails),
      'should handle missing credentials gracefully'
    );
  });

  it('get-email should require message_id', () => {
    const result = callTool(SKILL_ID, 'get-email', {}) as any;
    assertNotNull(result);
    assertFalse(result.success);
  });

  afterAll(() => {
    try {
      stopSkill(SKILL_ID);
    } catch {}
  });
});

// Run all tests
run();
