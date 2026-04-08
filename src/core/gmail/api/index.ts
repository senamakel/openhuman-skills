// ---------------------------------------------------------------------------
// Gmail API helper (uses net.fetch directly with Bearer token)
import { getGmailSkillState } from '../state';
import type { ApiError } from '../types';

/** Max retries on 429 rate-limit responses. */
const MAX_RETRIES = 3;

/** Default backoff in ms when Retry-After header is absent. */
const DEFAULT_BACKOFF_MS = 5_000;

/** Busy-wait sleep for retry backoff (QuickJS has no async setTimeout). */
function sleep(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy wait */
  }
}

const GMAIL_BASE_URL = 'https://gmail.googleapis.com/gmail/v1';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Cached access token for self_hosted mode (refresh_token → access_token exchange). */
let cachedSelfHostedToken: { token: string; expiresAt: number } | null = null;

/**
 * Resolve a Gmail access token from the available credential sources.
 *
 * Priority:
 * 1. Advanced auth (self_hosted): exchange refresh_token for access_token
 * 2. Advanced auth (text): use service account key (access_token field if pre-exchanged)
 * 3. OAuth credential with accessToken
 * 4. null — not connected
 */
function resolveAccessToken(): string | null {
  // Check advanced auth bridge first
  const authCred = auth.getCredential();
  if (authCred && authCred.mode === 'self_hosted') {
    const creds = authCred.credentials;
    const clientId = creds.client_id as string | undefined;
    const clientSecret = creds.client_secret as string | undefined;
    const refreshToken = creds.refresh_token as string | undefined;

    if (clientId && clientSecret && refreshToken) {
      // Use cached token if still valid (with 60s buffer)
      if (cachedSelfHostedToken && cachedSelfHostedToken.expiresAt > Date.now() + 60_000) {
        return cachedSelfHostedToken.token;
      }

      // Exchange refresh_token for access_token
      try {
        const body = `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&refresh_token=${encodeURIComponent(refreshToken)}&grant_type=refresh_token`;
        const response = net.fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          timeout: 15,
        });

        if (response.status === 200) {
          const data = JSON.parse(response.body) as { access_token: string; expires_in: number };
          cachedSelfHostedToken = {
            token: data.access_token,
            expiresAt: Date.now() + data.expires_in * 1000,
          };
          console.log('[gmail] Self-hosted token refreshed, expires in', data.expires_in, 's');
          return data.access_token;
        } else {
          console.error('[gmail] Token refresh failed:', response.status, response.body);
          return null;
        }
      } catch (err) {
        console.error('[gmail] Token refresh error:', err);
        return null;
      }
    }
  }

  if (authCred && authCred.mode === 'text') {
    // Text mode: the user pasted a service account JSON or an access token.
    // If the content looks like a raw token (no JSON structure), use it directly.
    const content = (authCred.credentials.content || '') as string;
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      // Service account JSON — would need JWT exchange (complex).
      // For now, check if there's an access_token or private_key field.
      if (parsed.access_token) {
        return parsed.access_token as string;
      }
      // Service account with private_key: not supported yet in QuickJS runtime
      // (would need JWT signing). Log a helpful message.
      if (parsed.private_key) {
        console.warn(
          '[gmail] Service account JSON detected but JWT signing is not yet supported. Use a refresh token flow instead.'
        );
        return null;
      }
    } catch {
      // Not JSON — treat as a raw access/bearer token
      if (content.trim()) {
        return content.trim();
      }
    }
    return null;
  }

  // Fall back to OAuth credential
  const oauthCred = oauth.getCredential();
  if (oauthCred && oauthCred.accessToken) {
    return oauthCred.accessToken as string;
  }

  return null;
}

/** Returns true if any form of Gmail credential is available. */
export function isGmailConnected(): boolean {
  const authCred = auth.getCredential();
  if (authCred && authCred.mode !== 'managed') return true;
  const oauthCred = oauth.getCredential();
  return !!oauthCred;
}

/** Reset cached self-hosted token (e.g., on credential change). */
export function resetTokenCache(): void {
  cachedSelfHostedToken = null;
}

export interface GmailApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export function gmailFetch<T = unknown>(
  endpoint: string,
  options: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    timeout?: number;
    rawBatch?: boolean;
  } = {}
): GmailApiResponse<T> {
  const cleanPath = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const method = options.method || 'GET';
  const timeout = options.timeout || 10;
  const isBatch = cleanPath === '/batch';

  // Determine whether to use direct API calls (with a resolved access token)
  // or the OAuth proxy (for encrypted/managed credentials without a local token).
  const oauthCred = oauth.getCredential();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Resolve token inside the loop so retries after 401 cache clear get a fresh token
    const accessToken = resolveAccessToken();
    const useProxy = !accessToken && !!oauthCred;

    if (!accessToken && !useProxy) {
      console.log('[gmail] gmailFetch: no access token and no OAuth credential');
      return {
        success: false,
        error: { code: 401, message: 'Gmail not connected. Complete setup first.' },
      };
    }

    try {
      let response: { status: number; headers: Record<string, string>; body: string };

      if (useProxy) {
        // Managed/encrypted OAuth: use the proxy which decrypts tokens server-side.
        // oauth.fetch path is relative to the manifest apiBaseUrl (gmail.googleapis.com/gmail/v1),
        // so pass the endpoint path directly without the /gmail/v1 prefix.
        console.log('[gmail] gmailFetch (proxy):', method, cleanPath);
        response = oauth.fetch(cleanPath, {
          method,
          headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
          body: options.body,
          timeout,
        });
      } else {
        // Direct API call with resolved access token
        const url = isBatch
          ? 'https://www.googleapis.com/batch/gmail/v1'
          : `${GMAIL_BASE_URL}${cleanPath}`;
        console.log('[gmail] gmailFetch (direct):', method, url);
        response = net.fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(isBatch ? {} : { 'Content-Type': 'application/json' }),
            ...(options.headers || {}),
          },
          body: options.body,
          timeout,
        });
      }
      console.log('[gmail] gmailFetch response status:', response.status);

      const s = getGmailSkillState();

      // -- 429 Rate Limit: back off and retry --------------------------------
      if (response.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = response.headers['retry-after'];
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : DEFAULT_BACKOFF_MS * (attempt + 1);
        console.log(
          `[gmail] gmailFetch: 429 rate-limited — retrying in ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
        );
        sleep(waitMs);
        continue;
      }

      // -- 401 Unauthorized: invalidate cached token and retry with fresh one -
      if (!useProxy && response.status === 401 && attempt < MAX_RETRIES) {
        const bodyPreview = response.body ? response.body.slice(0, 200) : '(empty)';
        console.log(`[gmail] gmailFetch: 401 Unauthorized body=${bodyPreview}`);
        cachedSelfHostedToken = null;
        // Token will be re-resolved at the top of the next iteration
        console.log('[gmail] gmailFetch: cleared token cache, retrying');
        continue;
      } else if (response.status >= 400) {
        const bodyPreview = response.body ? response.body.slice(0, 200) : '(empty)';
        console.log(`[gmail] gmailFetch: error status=${response.status} body=${bodyPreview}`);
      }

      // Update rate limit info from headers
      if (response.headers['x-ratelimit-remaining']) {
        s.rateLimitRemaining = parseInt(response.headers['x-ratelimit-remaining'], 10);
      }
      if (response.headers['x-ratelimit-reset']) {
        s.rateLimitReset = parseInt(response.headers['x-ratelimit-reset'], 10) * 1000;
      }

      if (response.status >= 200 && response.status < 300) {
        // Batch responses are multipart/mixed — return raw body without JSON parsing
        if (options.rawBatch) {
          s.lastApiError = null;
          return { success: true, data: response.body as unknown as T };
        }
        const data: T | undefined = response.body ? (JSON.parse(response.body) as T) : undefined;
        s.lastApiError = null;
        return { success: true, data };
      } else {
        const error: ApiError = response.body
          ? (JSON.parse(response.body) as ApiError)
          : { code: response.status, message: 'API request failed' };
        s.lastApiError = error.message || `HTTP ${response.status}`;
        return { success: false, error };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[gmail] gmailFetch error: ${errorMsg}`);
      const s = getGmailSkillState();
      s.lastApiError = errorMsg;
      return { success: false, error: { code: 500, message: errorMsg } };
    }
  }

  // Exhausted retries (only reachable after repeated 429s)
  return { success: false, error: { code: 429, message: 'Rate limit exceeded after retries' } };
}
