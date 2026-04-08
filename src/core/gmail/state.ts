// Shared skill state module for Gmail skill
// All modules import getGmailSkillState() and publishSkillState() directly.
import type { GmailSkillState } from './types';

// Module-level singleton state
const skillState: GmailSkillState = {
  config: {
    credentialId: '',
    userEmail: '',
    syncEnabled: true,
    syncIntervalMinutes: 15,
    maxEmailsPerSync: 100,
    notifyOnNewEmails: true,
    showSensitiveMessages: false,
  },
  profile: null,
  syncStatus: {
    lastSyncTime: 0,
    lastHistoryId: '',
    totalEmails: 0,
    newEmailsCount: 0,
    syncInProgress: false,
    nextSyncTime: 0,
    syncProgress: 0,
    syncProgressMessage: '',
  },
  activeSessions: [],
  rateLimitRemaining: 250,
  rateLimitReset: Date.now() + 3600000,
  lastApiError: null,
};

export function getGmailSkillState(): GmailSkillState {
  return skillState;
}

export function publishSkillState(): void {
  const s = skillState;
  const credential = oauth.getCredential();
  const isConnected = !!credential;

  state.setPartial({
    // Standard SkillHostConnectionState fields
    connection_status: isConnected ? 'connected' : 'disconnected',
    auth_status: isConnected ? 'authenticated' : 'not_authenticated',
    connection_error: s.lastApiError || null,
    auth_error: null,
    is_initialized: isConnected,
    // Skill-specific fields
    userEmail: s.config.userEmail,
    syncEnabled: s.config.syncEnabled,
    syncInProgress: s.syncStatus.syncInProgress,
    syncProgress: s.syncStatus.syncProgress,
    syncProgressMessage: s.syncStatus.syncProgressMessage || null,
    lastSyncTime: s.syncStatus.lastSyncTime || null,
    nextSyncTime: s.syncStatus.nextSyncTime || null,
    totalEmails: s.syncStatus.totalEmails,
    newEmailsCount: s.syncStatus.newEmailsCount,
    activeSessions: s.activeSessions.length,
    rateLimitRemaining: s.rateLimitRemaining,
    lastError: s.lastApiError,
  });
}
