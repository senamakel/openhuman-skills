// Gmail skill main entry point
// Gmail integration with OAuth bridge; sync sends list API response (id + threadId) to frontend.
import { loadGmailProfile } from './api/helpers';
import { isGmailConnected, resetTokenCache } from './api/index';
import { getEmailCount } from './db/helpers';
import { initializeGmailSchema } from './db/schema';
import { getGmailSkillState } from './state';
import { onSync } from './sync';
import { tools } from './tools';
import type { SkillConfig } from './types';

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

function init(): void {
  console.log(`[gmail] Initializing on ${platform.os()}`);
  const s = getGmailSkillState();

  // Initialize database schema
  initializeGmailSchema();

  // Load persisted config from store
  const saved = state.get('config') as Partial<SkillConfig> | null;
  if (saved) {
    s.config.credentialId = saved.credentialId || s.config.credentialId;
    s.config.userEmail = saved.userEmail || s.config.userEmail;
    s.config.syncEnabled = saved.syncEnabled != null ? saved.syncEnabled : s.config.syncEnabled;
    s.config.syncIntervalMinutes = saved.syncIntervalMinutes || s.config.syncIntervalMinutes;
    s.config.maxEmailsPerSync = saved.maxEmailsPerSync || s.config.maxEmailsPerSync;
    s.config.notifyOnNewEmails =
      saved.notifyOnNewEmails != null ? saved.notifyOnNewEmails : s.config.notifyOnNewEmails;
    s.config.showSensitiveMessages =
      saved.showSensitiveMessages != null
        ? saved.showSensitiveMessages
        : s.config.showSensitiveMessages;
  }

  // Load sync status from persistent state
  const lastSync = state.get('lastSyncTime');
  const lastHistoryId = state.get('lastHistoryId');
  if (typeof lastSync === 'number') s.syncStatus.lastSyncTime = lastSync;
  if (typeof lastHistoryId === 'string') s.syncStatus.lastHistoryId = lastHistoryId;
  s.syncStatus.totalEmails = getEmailCount();

  const isConnected = isGmailConnected();
  console.log(`[gmail] Initialized. Connected: ${isConnected}`);
}

function start(): void {
  console.log('[gmail] Starting skill...');
  const s = getGmailSkillState();
  if (isGmailConnected() && s.config.syncEnabled) {
    // Register periodic sync via cron without blocking startup on full sync.
    const cronExpr = `0 */${s.config.syncIntervalMinutes} * * * *`;
    cron.register('gmail-sync', cronExpr);
    publishSkillState();
  } else {
    console.log('[gmail] Not connected or sync disabled');
  }
}

function stop(): void {
  console.log('[gmail] Skill stopped');
}

function onCronTrigger(scheduleId: string): void {
  console.log(`[gmail] Cron triggered: ${scheduleId}`);
  if (scheduleId === 'gmail-sync') {
    onSync();
  }
}

function onSessionStart(args: { sessionId: string }): void {
  const s = getGmailSkillState();
  s.activeSessions.push(args.sessionId);
  console.log(`[gmail] Session started: ${args.sessionId} (${s.activeSessions.length} active)`);
}

function onSessionEnd(args: { sessionId: string }): void {
  const s = getGmailSkillState();
  const index = s.activeSessions.indexOf(args.sessionId);
  if (index > -1) {
    s.activeSessions.splice(index, 1);
  }
  console.log(`[gmail] Session ended: ${args.sessionId} (${s.activeSessions.length} active)`);
}

// ---------------------------------------------------------------------------
// OAuth lifecycle hooks
// ---------------------------------------------------------------------------

function onOAuthComplete(args: OAuthCompleteArgs): OAuthCompleteResult | void {
  console.log(`[gmail] OAuth complete for provider: ${args.provider}`);
  const s = getGmailSkillState();

  s.config.credentialId = args.credentialId;
  if (args.accountLabel) {
    s.config.userEmail = args.accountLabel;
  }

  state.set('config', s.config);

  publishSkillState();
}

function onOAuthRevoked(args: OAuthRevokedArgs): void {
  console.log(`[gmail] OAuth revoked: ${args.reason}`);
  const s = getGmailSkillState();

  s.config.credentialId = '';
  s.config.userEmail = '';
  s.profile = null;

  state.set('config', s.config);
  cron.unregister('gmail-sync');
  publishSkillState();

  if (args.reason === 'token_expired' || args.reason === 'provider_revoked') {
    platform.notify('Gmail Disconnected', 'Your Gmail connection has expired. Please reconnect.');
  }
}

function onDisconnect(): void {
  console.log('[gmail] Disconnecting...');
  const s = getGmailSkillState();

  // Revoke via OAuth bridge
  oauth.revoke();

  s.config = {
    credentialId: '',
    userEmail: '',
    syncEnabled: true,
    syncIntervalMinutes: 15,
    maxEmailsPerSync: 100,
    notifyOnNewEmails: true,
  };

  s.profile = null;
  state.delete('config');
  cron.unregister('gmail-sync');
  publishSkillState();

  console.log('[gmail] Disconnected and cleaned up');
}

// ---------------------------------------------------------------------------
// Advanced auth lifecycle (self_hosted / text modes)
// ---------------------------------------------------------------------------

function onAuthComplete(args: { mode: string; credentials: Record<string, unknown> }): {
  status: string;
  errors?: Array<{ field: string; message: string }>;
  message?: string;
} {
  console.log(`[gmail] onAuthComplete — mode: ${args.mode}`);
  const s = getGmailSkillState();

  if (args.mode === 'managed') {
    return { status: 'complete' };
  }

  // Reset any cached tokens from a previous credential
  resetTokenCache();

  if (args.mode === 'self_hosted') {
    const clientId = args.credentials.client_id as string | undefined;
    const clientSecret = args.credentials.client_secret as string | undefined;
    const refreshToken = args.credentials.refresh_token as string | undefined;

    if (!clientId || !clientSecret || !refreshToken) {
      return {
        status: 'error',
        errors: [{ field: 'refresh_token', message: 'All three fields are required.' }],
      };
    }

    // Validate by exchanging refresh_token for access_token
    try {
      const body = `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&refresh_token=${encodeURIComponent(refreshToken)}&grant_type=refresh_token`;
      const response = net.fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        timeout: 15,
      });

      if (response.status !== 200) {
        let errorMsg = 'Invalid credentials.';
        try {
          const parsed = JSON.parse(response.body) as { error_description?: string };
          if (parsed.error_description) errorMsg = parsed.error_description;
        } catch {
          /* use default */
        }
        return { status: 'error', errors: [{ field: 'refresh_token', message: errorMsg }] };
      }

      // Token exchange succeeded — test Gmail API access
      const tokenData = JSON.parse(response.body) as { access_token: string };
      const profileResp = net.fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        timeout: 10,
      });

      if (profileResp.status !== 200) {
        return {
          status: 'error',
          errors: [
            {
              field: 'client_id',
              message:
                'Token is valid but Gmail API access failed. Ensure Gmail API is enabled in your Google Cloud project.',
            },
          ],
        };
      }

      // Extract email from profile
      try {
        const profile = JSON.parse(profileResp.body) as { emailAddress?: string };
        if (profile.emailAddress) {
          s.config.userEmail = profile.emailAddress;
        }
      } catch {
        /* non-critical */
      }
    } catch (err) {
      return {
        status: 'error',
        errors: [{ field: 'client_id', message: `Could not reach Google API: ${String(err)}` }],
      };
    }
  }

  if (args.mode === 'text') {
    const content = (args.credentials.content || '') as string;
    if (!content.trim()) {
      return {
        status: 'error',
        errors: [{ field: 'content', message: 'Credential content is required.' }],
      };
    }

    // Try to validate — if it looks like a token, test it directly
    let token = content.trim();
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      if (parsed.access_token) {
        token = parsed.access_token as string;
      } else if (parsed.private_key) {
        return {
          status: 'error',
          errors: [
            {
              field: 'content',
              message:
                'Service account JSON with private_key is not yet supported. Use a refresh token or access token instead.',
            },
          ],
        };
      }
    } catch {
      // Not JSON — treat as raw token
    }

    // Test the token against Gmail
    try {
      const profileResp = net.fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        timeout: 10,
      });

      if (profileResp.status === 401 || profileResp.status === 403) {
        return {
          status: 'error',
          errors: [{ field: 'content', message: 'Invalid or expired token.' }],
        };
      }

      if (profileResp.status !== 200) {
        const bodyPreview = profileResp.body ? profileResp.body.slice(0, 200) : '';
        return {
          status: 'error',
          errors: [
            {
              field: 'content',
              message: `Gmail API returned ${profileResp.status}. ${bodyPreview}`.trim(),
            },
          ],
        };
      }

      try {
        const profile = JSON.parse(profileResp.body) as { emailAddress?: string };
        if (profile.emailAddress) {
          s.config.userEmail = profile.emailAddress;
        }
      } catch {
        /* non-critical */
      }
    } catch (err) {
      return {
        status: 'error',
        errors: [{ field: 'content', message: `Could not reach Gmail API: ${String(err)}` }],
      };
    }
  }

  // Save config and start sync
  state.set('config', s.config);

  if (s.config.syncEnabled) {
    const cronExpr = `0 */${s.config.syncIntervalMinutes} * * * *`;
    cron.register('gmail-sync', cronExpr);
  }

  publishSkillState();

  return { status: 'complete', message: 'Connected to Gmail!' };
}

function onAuthRevoked(args: { mode?: string }): void {
  console.log(`[gmail] Auth revoked — mode: ${args.mode || 'unknown'}`);
  const s = getGmailSkillState();

  s.config.credentialId = '';
  s.config.userEmail = '';
  s.profile = null;
  state.delete('config');
  cron.unregister('gmail-sync');
  resetTokenCache();
  publishSkillState();
}

// ---------------------------------------------------------------------------
// Setup compatibility stubs (required while validator expects onSetupStart/onSetupSubmit)
// ---------------------------------------------------------------------------

function onSetupStart(): SetupStartResult {
  // Auth phase already handled credentials — return a pass-through step
  return {
    step: {
      id: 'auth_done',
      title: 'Setup Complete',
      description: 'Authentication is configured. Click Continue to finish.',
      fields: [],
    },
  };
}

function onSetupSubmit(_args: {
  stepId: string;
  values: Record<string, unknown>;
}): SetupSubmitResult {
  return { status: 'complete' };
}

// ---------------------------------------------------------------------------
// Options system
// ---------------------------------------------------------------------------

function onListOptions(): { options: SkillOption[] } {
  const s = getGmailSkillState();

  return {
    options: [
      {
        name: 'syncEnabled',
        type: 'boolean',
        label: 'Enable Email Sync',
        value: s.config.syncEnabled,
      },
      {
        name: 'syncInterval',
        type: 'select',
        label: 'Sync Interval',
        value: s.config.syncIntervalMinutes.toString(),
        options: [
          { label: 'Every 5 minutes', value: '5' },
          { label: 'Every 15 minutes', value: '15' },
          { label: 'Every 30 minutes', value: '30' },
          { label: 'Every hour', value: '60' },
        ],
      },
      {
        name: 'maxEmailsPerSync',
        type: 'select',
        label: 'Max Emails Per Sync',
        value: s.config.maxEmailsPerSync.toString(),
        options: [
          { label: '50 emails', value: '50' },
          { label: '100 emails', value: '100' },
          { label: '250 emails', value: '250' },
          { label: '500 emails', value: '500' },
        ],
      },
      {
        name: 'notifyOnNewEmails',
        type: 'boolean',
        label: 'Notify on New Emails',
        value: s.config.notifyOnNewEmails,
      },
      {
        name: 'showSensitiveMessages',
        type: 'boolean',
        label: 'Show Sensitive Messages',
        value: s.config.showSensitiveMessages || false,
      },
    ],
  };
}

function onSetOption(args: { name: string; value: unknown }): void {
  const s = getGmailSkillState();
  const connected = isGmailConnected();

  switch (args.name) {
    case 'syncEnabled':
      s.config.syncEnabled = Boolean(args.value);
      if (s.config.syncEnabled && connected) {
        const cronExpr = `0 */${s.config.syncIntervalMinutes} * * * *`;
        cron.register('gmail-sync', cronExpr);
      } else {
        cron.unregister('gmail-sync');
      }
      break;

    case 'syncInterval':
      s.config.syncIntervalMinutes = parseInt(args.value as string, 10);
      if (s.config.syncEnabled && connected) {
        cron.unregister('gmail-sync');
        const cronExpr = `0 */${s.config.syncIntervalMinutes} * * * *`;
        cron.register('gmail-sync', cronExpr);
      }
      break;

    case 'maxEmailsPerSync':
      s.config.maxEmailsPerSync = parseInt(args.value as string, 10);
      break;

    case 'notifyOnNewEmails':
      s.config.notifyOnNewEmails = Boolean(args.value);
      break;

    case 'showSensitiveMessages':
      s.config.showSensitiveMessages = Boolean(args.value);
      break;
  }

  // Save updated config
  state.set('config', s.config);
  publishSkillState();
}

function publishSkillState(): void {
  const s = getGmailSkillState();
  const isConnected = isGmailConnected();

  // Profile and emails for frontend gmail store (gmailSlice) — only when connected
  const profile =
    isConnected && s.profile != null
      ? {
          email_address: s.profile.emailAddress,
          messages_total: s.profile.messagesTotal,
          threads_total: s.profile.threadsTotal,
          history_id: s.profile.historyId,
        }
      : null;

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
    lastSyncTime: new Date(s.syncStatus.lastSyncTime).toISOString(),
    nextSyncTime: new Date(s.syncStatus.nextSyncTime).toISOString(),
    totalEmails: s.syncStatus.totalEmails,
    newEmailsCount: s.syncStatus.newEmailsCount,
    activeSessions: s.activeSessions.length,
    rateLimitRemaining: s.rateLimitRemaining,
    lastError: s.lastApiError,
    // For frontend gmail store (gmailSlice)
    profile,
  });
}

// Expose helper functions on globalThis for tools to use
const _g = globalThis as Record<string, unknown>;
_g.getGmailSkillState = getGmailSkillState;
_g.publishSkillState = publishSkillState;
_g.loadGmailProfile = loadGmailProfile;

const skill: Skill = {
  info: {
    id: 'gmail',
    name: 'Gmail',
    version: '2.1.0',
    description: 'Gmail integration with persistent storage',
    auto_start: false,
    setup: { required: true, label: 'Configure Gmail' },
  },
  tools,
  init,
  start,
  stop,
  onCronTrigger,
  onSessionStart,
  onSessionEnd,
  onOAuthComplete,
  onOAuthRevoked,
  onAuthComplete,
  onAuthRevoked,
  onSetupStart,
  onSetupSubmit,
  onSync,
  onDisconnect,
  onListOptions,
  onSetOption,
};

export default skill;
