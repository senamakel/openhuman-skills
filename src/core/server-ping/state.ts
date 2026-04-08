// Shared skill state module
// Tools and lifecycle functions access state through globalThis.getSkillState()
// This pattern works in both production QuickJS runtime and test harness sandbox.
import type { SkillConfig } from './types';

/**
 * Skill state interface - defines the shape of our mutable state
 */
export interface ServerPingState {
  config: SkillConfig;
  pingCount: number;
  failCount: number;
  consecutiveFails: number;
  wasDown: boolean;
  activeSessions: string[];
  pingIntervalId: number | null;
}

const _g = globalThis as Record<string, unknown>;

/**
 * Initialize the skill state. Called once at module load.
 */
function initSkillState(): ServerPingState {
  const stateObj: ServerPingState = {
    config: {
      serverUrl: '',
      pingIntervalSec: 10,
      notifyOnDown: true,
      notifyOnRecover: true,
      verboseLogging: false,
    },
    pingCount: 0,
    failCount: 0,
    consecutiveFails: 0,
    wasDown: false,
    activeSessions: [],
    pingIntervalId: null,
  };

  _g.__skillState = stateObj;
  return stateObj;
}

// Initialize on module load
initSkillState();

// Expose getSkillState as a global function
_g.getSkillState = function getSkillState(): ServerPingState {
  const s = _g.__skillState as ServerPingState;
  if (!s) {
    throw new Error('[server-ping] Skill state not initialized');
  }
  return s;
};

/** Typed accessor for use within this skill's source files. Delegates to globalThis so bundle works. */
export function getSkillState(): ServerPingState {
  return (_g.getSkillState as () => ServerPingState)();
}
