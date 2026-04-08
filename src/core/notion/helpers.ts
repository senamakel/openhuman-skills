// Notion API helpers and formatting functions

// ---------------------------------------------------------------------------
// Notion API helpers
// ---------------------------------------------------------------------------

/** Max retries on 429 rate-limit and Cloudflare transient errors. */
const MAX_RETRIES = 3;

/** Default backoff in ms when Retry-After header is absent. */
const DEFAULT_BACKOFF_MS = 5_000;

/**
 * Cloudflare-originated status codes that are transient and safe to retry.
 * 520 – Unknown Error, 521 – Web Server Down, 522 – Connection Timed Out,
 * 523 – Origin Unreachable, 524 – A Timeout Occurred, 525 – SSL Handshake Failed,
 * 526 – Invalid SSL Certificate, 527 – Railgun Listener Error.
 */
const CLOUDFLARE_RETRYABLE = new Set([520, 521, 522, 523, 524, 525, 526, 527]);

/** Notion API version — hardcoded to latest. */
export const NOTION_API_VERSION = '2026-03-11';

/** Synchronous busy-wait sleep for backoff waits. */
function sleep(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy wait — QuickJS has no sync sleep primitive
  }
}

/**
 * Resolve the effective Notion credential from either the advanced auth bridge
 * or the legacy OAuth bridge.
 *
 * Returns:
 * - `{ type: 'token', token: string }` — direct API token (self_hosted or accessToken)
 * - `{ type: 'proxy' }` — use oauth.fetch() server-side proxy
 * - `null` — not connected
 */
export function getNotionAuth(): { type: 'token'; token: string } | { type: 'proxy' } | null {
  // Check advanced auth bridge first (self_hosted / text modes)
  const authCred = auth.getCredential();
  if (authCred && authCred.mode !== 'managed') {
    const creds = authCred.credentials;
    const token = (creds.api_token || creds.content || creds.access_token) as string | undefined;
    if (token) {
      return { type: 'token', token };
    }
  }

  // Check OAuth bridge (managed mode or legacy)
  const oauthCred = oauth.getCredential();
  if (oauthCred) {
    if (oauthCred.accessToken) {
      return { type: 'token', token: oauthCred.accessToken as string };
    }
    return { type: 'proxy' };
  }

  return null;
}

/** Returns true if any form of Notion credential is available. */
export function isNotionConnected(): boolean {
  return getNotionAuth() !== null;
}

export function notionFetch<T>(
  endpoint: string,
  options: { method?: string; body?: unknown } = {}
): T {
  const notionAuth = getNotionAuth();
  if (!notionAuth) throw new Error('Notion not connected. Please complete setup first.');

  const method = options.method || 'GET';
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const apiVersion = NOTION_API_VERSION;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: { status: number; headers: Record<string, string>; body: string };

    const t0 = Date.now();

    if (notionAuth.type === 'token') {
      // Direct Notion API call with token (self_hosted API token or OAuth accessToken)
      const url = `https://api.notion.com/v1${path}`;
      console.log(`[notion][fetch] ${method} ${url} (direct, attempt ${attempt})`);
      response = net.fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${notionAuth.token}`,
          'Content-Type': 'application/json',
          'Notion-Version': apiVersion,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        timeout: 30,
      });
    } else {
      // Server-side OAuth proxy — the proxy validates against an allowlist of
      // full paths (e.g. /v1/users, /v1/search), so we must include the /v1 prefix.
      console.log(`[notion][fetch] ${method} /v1${path} (proxy, attempt ${attempt})`);
      response = oauth.fetch(`/v1${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'Notion-Version': apiVersion },
        body: options.body ? JSON.stringify(options.body) : undefined,
        timeout: 30,
      });
    }

    const elapsed = Date.now() - t0;
    const bodyLen = response.body ? response.body.length : 0;
    console.log(
      `[notion][fetch] ${method} ${path} status=${response.status} (${elapsed}ms, ${bodyLen}b)`
    );

    // -- 429 Rate Limit: back off and retry ----------------------------------
    if (response.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = response.headers['retry-after'];
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : DEFAULT_BACKOFF_MS * (attempt + 1);
      console.warn(
        `[notion][helpers] 429 rate-limited — waiting ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
      );
      sleep(waitMs);
      continue;
    }

    // -- 5xx Cloudflare transient errors: exponential backoff and retry ------
    if (CLOUDFLARE_RETRYABLE.has(response.status) && attempt < MAX_RETRIES) {
      const waitMs = DEFAULT_BACKOFF_MS * Math.pow(2, attempt); // 5s, 10s, 20s
      console.warn(
        `[notion][helpers] Cloudflare ${response.status} (transient) — waiting ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
      );
      sleep(waitMs);
      continue;
    }

    if (response.status >= 400) {
      const errorBody = response.body || '';
      // Always include the raw body for debugging
      let message = `Notion API error: ${response.status} — ${errorBody.slice(0, 300)}`;
      console.error('[notion][helpers] notionFetch error body:', errorBody);
      throw new Error(message);
    }

    const parsed = JSON.parse(response.body as string) as T;
    return parsed;
  }

  // Exhausted retries (reachable after repeated 429s or Cloudflare 5xx errors)
  throw new Error(
    'Notion API error: request failed after maximum retries (rate limit or upstream timeout)'
  );
}

export function formatApiError(error: unknown): string {
  const message = String(error);

  if (message.includes('401')) {
    return 'Unauthorized. Check that your integration token is valid.';
  }
  if (message.includes('404')) {
    return 'Not found. Make sure the page/database is shared with your integration.';
  }
  if (message.includes('429')) {
    return 'Rate limited. Please try again in a moment.';
  }
  if (/52[0-7]/.test(message)) {
    return 'Notion is temporarily unreachable (Cloudflare gateway error). The request will be retried automatically.';
  }
  if (message.includes('403')) {
    return 'Forbidden. The integration may not have access to this resource.';
  }
  if (message.includes('invalid_version')) {
    return 'API version not supported. The skill will automatically retry with a compatible version.';
  }
  if (message.includes('data_source')) {
    return 'Database access issue. This may be due to API version compatibility. The skill will attempt to resolve this automatically.';
  }
  if (
    message.toLowerCase().includes('insufficient permissions') ||
    message.toLowerCase().includes('insert comment')
  ) {
    return (
      'Insufficient permissions: the Notion integration must have "Insert comment" (and optionally "Read comment") capability. ' +
      'Enable it in Notion: Settings & members → Connections → your integration → Capabilities.'
    );
  }

  return message;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function formatRichText(richText: unknown[]): string {
  if (!Array.isArray(richText)) return '';
  return richText
    .map(rt => {
      const item = rt as Record<string, unknown>;
      return (item.plain_text as string) || '';
    })
    .join('');
}

export function formatPageTitle(page: Record<string, unknown>): string {
  const props = page.properties as Record<string, unknown>;
  if (!props) return page.id as string;

  for (const key of Object.keys(props)) {
    const prop = props[key] as Record<string, unknown>;
    if (prop.type === 'title' && Array.isArray(prop.title)) {
      const title = formatRichText(prop.title);
      if (title) return title;
    }
  }

  return page.id as string;
}

export function formatPageSummary(page: Record<string, unknown>): Record<string, unknown> {
  return {
    id: page.id,
    title: formatPageTitle(page),
    url: page.url,
    created_time: page.created_time,
    last_edited_time: page.last_edited_time,
    archived: page.archived,
    parent_type: page.parent ? (page.parent as Record<string, unknown>).type : undefined,
  };
}

export function formatDatabaseSummary(db: Record<string, unknown>): Record<string, unknown> {
  const title = Array.isArray(db.title) ? formatRichText(db.title) : '';
  return {
    id: db.id,
    title: title || '(Untitled)',
    url: db.url,
    created_time: db.created_time,
    last_edited_time: db.last_edited_time,
    property_count: Object.keys(db.properties || {}).length,
  };
}

export function formatBlockContent(block: Record<string, unknown>): string {
  const type = block.type as string;
  const content = block[type] as Record<string, unknown> | undefined;

  if (!content) return `[${type}]`;

  if (content.rich_text && Array.isArray(content.rich_text)) {
    const text = formatRichText(content.rich_text);
    return text || `[empty ${type}]`;
  }

  if (content.children) {
    return `[${type} with children]`;
  }

  return `[${type}]`;
}

export function formatBlockSummary(block: Record<string, unknown>): Record<string, unknown> {
  return {
    id: block.id,
    type: block.type,
    has_children: block.has_children,
    content: formatBlockContent(block),
  };
}

export function formatUserSummary(user: Record<string, unknown>): Record<string, unknown> {
  // Default to top-level user fields
  let id = user.id as string;
  let name = user.name as string | undefined;
  let email: string | undefined;
  let avatarUrl = user.avatar_url as string | undefined;
  let userType = user.type as string | undefined;

  // For bot-type users, drill into bot.owner.user.person to get the human owner info
  if (userType === 'bot') {
    const bot = user.bot as Record<string, unknown> | undefined;
    const owner = (bot ? bot.owner : undefined) as Record<string, unknown> | undefined;
    const ownerUser = (owner ? owner.user : undefined) as Record<string, unknown> | undefined;
    const ownerPerson = (ownerUser ? ownerUser.person : undefined) as
      | Record<string, unknown>
      | undefined;

    if (ownerUser) {
      id = (ownerUser.id as string) || id;
      name = (ownerUser.name as string) || name;
      avatarUrl = (ownerUser.avatar_url as string) || avatarUrl;
      userType = (ownerUser.type as string) || userType;
    }
    if (ownerPerson) {
      email = (ownerPerson.email as string) || email;
    }
  } else {
    const person = user.person as Record<string, unknown> | undefined;
    email = ((person ? person.email : undefined) as string) || (user.email as string | undefined);
  }

  return {
    id,
    name: name !== null && name !== undefined ? name : null,
    email: email !== null && email !== undefined ? email : null,
    type: userType !== null && userType !== undefined ? userType : null,
    avatar_url: avatarUrl !== null && avatarUrl !== undefined ? avatarUrl : null,
  };
}

// ---------------------------------------------------------------------------
// Rich text builders for creating content
// ---------------------------------------------------------------------------

/** Rich text item for block creation; matches Notion API request format. */
export function buildRichText(text: string): unknown[] {
  return [{ type: 'text', text: { content: text } }];
}

/**
 * Build a paragraph block for append-block-children requests.
 * Uses minimal request shape (type + paragraph.rich_text) per Notion API.
 * Do not add "object" or "children" to avoid validation errors.
 */
export function buildParagraphBlock(text: string): Record<string, unknown> {
  return { type: 'paragraph', paragraph: { rich_text: buildRichText(text) } };
}

// ---------------------------------------------------------------------------
// Block tree text extraction for content sync
// ---------------------------------------------------------------------------

/**
 * Recursively fetch block children and extract plain text content.
 * Used by the sync engine to populate page content_text.
 */
export function fetchBlockTreeText(blockId: string, maxDepth: number = 2): string {
  if (maxDepth < 0) return '';

  const lines: string[] = [];
  let startCursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const endpoint = `/blocks/${blockId}/children?page_size=100${startCursor ? `&start_cursor=${startCursor}` : ''}`;

    let result: { results: Record<string, unknown>[]; has_more: boolean; next_cursor?: string };
    try {
      result = notionFetch(endpoint) as typeof result;
    } catch {
      break;
    }

    for (const block of result.results) {
      const text = formatBlockContent(block);
      if (text && !text.startsWith('[') && !text.endsWith(']')) {
        lines.push(text);
      } else if (text && text !== `[${block.type as string}]`) {
        const cleaned = text.replace(/^\[empty .*\]$/, '').trim();
        if (cleaned) lines.push(cleaned);
      }

      if (block.has_children && maxDepth > 0) {
        const childText = fetchBlockTreeText(block.id as string, maxDepth - 1);
        if (childText) lines.push(childText);
      }
    }

    hasMore = result.has_more;
    startCursor = result.next_cursor as string | undefined;
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Data Source Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a database ID to its data source ID.
 * The current API uses data_sources for queries and schema access.
 */
export function resolveDataSourceId(databaseId: string): string {
  try {
    const response = notionFetch<{ data_sources?: Array<{ id: string }>; id: string }>(
      `/databases/${databaseId}`
    );

    if (response.data_sources && response.data_sources.length > 0) {
      const dataSourceId = response.data_sources[0].id;
      console.log(
        `[notion][helpers] Resolved database ${databaseId} to data source ${dataSourceId}`
      );
      return dataSourceId;
    }

    return databaseId;
  } catch (error) {
    console.log(
      `[notion][helpers] Error resolving data source for ${databaseId}, using original ID:`,
      error
    );
    return databaseId;
  }
}

/**
 * Get the query endpoint for a database — resolves to data_sources endpoint.
 */
export function getQueryEndpoint(databaseId: string): string {
  const dataSourceId = resolveDataSourceId(databaseId);
  return `/data_sources/${dataSourceId}/query`;
}
