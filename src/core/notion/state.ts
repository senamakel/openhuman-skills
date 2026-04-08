// Shared skill state module for Notion skill.
// State is stored on globalThis for the runtime host; use getNotionSkillState() import elsewhere.

export interface NotionSkillConfig {
  credentialId: string;
  workspaceName: string;
  syncIntervalMinutes: number;
  contentSyncEnabled: boolean;
  maxPagesPerContentSync: number;
}

export interface NotionSyncStatus {
  syncInProgress: boolean;
  lastSyncTime: number;
  nextSyncTime: number;
  totalPages: number;
  totalDatabases: number;
  totalDatabaseRows: number;
  pagesWithContent: number;
  pagesWithSummary: number;
  summariesTotal: number;
  summariesPending: number;
  lastSyncError: string | null;
  lastSyncDurationMs: number;
  /** Current sync phase label (e.g. "users", "pages", "content", "ingestion") */
  syncPhase: string | null;
  /** 0-100 progress within the current sync run */
  syncProgress: number;
  /** Human-readable status message (e.g. "Fetching pages... 450 so far") */
  syncMessage: string | null;
}

export interface NotionSkillState {
  config: NotionSkillConfig;
  syncStatus: NotionSyncStatus;
  activeSessions: string[];
}

// Extend globalThis type
declare global {
  function getNotionSkillState(): NotionSkillState;

  var __notionSkillState: NotionSkillState;
}

/**
 * Initialize the Notion skill state. Called once at module load.
 */
function initNotionSkillState(): NotionSkillState {
  const s: NotionSkillState = {
    config: {
      credentialId: '',
      workspaceName: '',
      syncIntervalMinutes: 20,
      contentSyncEnabled: true,
      maxPagesPerContentSync: 500,
    },
    syncStatus: {
      syncInProgress: false,
      lastSyncTime: 0,
      nextSyncTime: 0,
      totalPages: 0,
      totalDatabases: 0,
      totalDatabaseRows: 0,
      pagesWithContent: 0,
      pagesWithSummary: 0,
      summariesTotal: 0,
      summariesPending: 0,
      lastSyncError: null,
      lastSyncDurationMs: 0,
      syncPhase: null,
      syncProgress: 0,
      syncMessage: null,
    },
    activeSessions: [],
  };

  globalThis.__notionSkillState = s;
  return s;
}

// Initialize on module load
initNotionSkillState();

// Expose getNotionSkillState as a global function
globalThis.getNotionSkillState = function getNotionSkillState(): NotionSkillState {
  const s = globalThis.__notionSkillState;
  if (!s) {
    throw new Error('[notion] Skill state not initialized');
  }
  return s;
};

export function getNotionSkillState(): NotionSkillState {
  const s = globalThis.__notionSkillState;
  if (!s) throw new Error('[notion] Skill state not initialized');
  return s;
}
