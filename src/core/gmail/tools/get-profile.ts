// Tool: gmail-get-profile
// Get Gmail user profile information.
import { gmailFetch } from '../api/index';
import { getGmailSkillState } from '../state';
import { GmailProfile } from '../types';

export const getProfileTool: ToolDefinition = {
  name: 'get-profile',
  description:
    'Get Gmail user profile information including email address, total message counts, and account details. Optional accessToken for frontend calls.',
  input_schema: { type: 'object', properties: {}, required: [] },
  execute(_args: Record<string, unknown>): string {
    try {
      const response = gmailFetch<GmailProfile>('/users/me/profile');

      if (!response.success) {
        return JSON.stringify({
          success: false,
          error: (response.error ? response.error.message : null) || 'Failed to fetch profile',
        });
      }

      const profile = response.data as {
        emailAddress: string;
        messagesTotal?: number;
        threadsTotal?: number;
        historyId?: string;
      };

      const s = getGmailSkillState();
      s.profile = {
        emailAddress: profile.emailAddress,
        messagesTotal: profile.messagesTotal || 0,
        threadsTotal: profile.threadsTotal || 0,
        historyId: profile.historyId || '',
      };
      if (!s.config.userEmail) {
        s.config.userEmail = profile.emailAddress;
        state.set('config', s.config);
      }

      return JSON.stringify({
        success: true,
        profile: {
          email_address: profile.emailAddress,
          messages_total: profile.messagesTotal || 0,
          threads_total: profile.threadsTotal || 0,
          history_id: profile.historyId,
        },
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
