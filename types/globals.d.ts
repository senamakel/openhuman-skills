// Ambient type declarations for the OpenHuman QuickJS skill runtime.
// These match the friendly API layer injected by the Rust host.

// ---------------------------------------------------------------------------
// Bridge namespaces
// ---------------------------------------------------------------------------

/** SQLite database scoped to this skill. */
declare const db: {
  /** Execute a SQL statement (INSERT, UPDATE, DELETE, CREATE, etc.). */
  exec(sql: string, params?: unknown[]): void;
  /** Query a single row. Returns the row object or `null`. */
  get(sql: string, params?: unknown[]): Record<string, unknown> | null;
  /** Query multiple rows. Returns an array of row objects. */
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  /** Get a value from the built-in key-value table. */
  kvGet(key: string): unknown;
  /** Set a value in the built-in key-value table. */
  kvSet(key: string, value: unknown): void;
};

/** HTTP networking. */
declare const net: {
  /** Synchronous HTTP fetch. Returns the parsed response. */
  fetch(url: string, options?: NetFetchOptions): NetFetchResponse;
};

/** Cron scheduling. */
declare const cron: {
  /** Register a cron schedule. `cronExpr` uses 6-field syntax (seconds). */
  register(scheduleId: string, cronExpr: string): void;
  /** Unregister a previously registered schedule. */
  unregister(scheduleId: string): void;
  /** List all registered schedules for this skill. */
  list(): string[];
};

/** Inter-skill communication. */
declare const skills: {
  /** List all registered skills. */
  list(): SkillInfo[];
  /** Call a tool exposed by another skill. */
  callTool(skillId: string, toolName: string, args?: Record<string, unknown>): unknown;
};

/** Platform information and OS integration. */
declare const platform: {
  /** Current OS: "windows", "macos", "linux", "android", "ios". */
  os(): string;
  /** Read a whitelisted environment variable. Returns the value or `""`. */
  env(key: string): string;
  /** Send a desktop notification. */
  notify(title: string, body?: string): void;
};

/** Persistent key-value state, also published to the frontend in real time. */
declare const state: {
  /** Get a single value by key. Returns the parsed value or `null`. */
  get(key: string): unknown;
  /** Set a single value by key (JSON-serializable). Persists and publishes to frontend. */
  set(key: string, value: unknown): void;
  /** Merge a partial object into the current state. Persists and publishes to frontend. */
  setPartial(partial: Record<string, unknown>): void;
  /** Delete a key. */
  delete(key: string): void;
  /** List all keys. */
  keys(): string[];
};

/** File I/O in the skill's isolated data directory. */
declare const data: {
  /** Read a file. Returns the content string or `null` if not found. */
  read(filename: string): string | null;
  /** Write a file (creates or overwrites). */
  write(filename: string, content: string): void;
};

/** Event-based hooks system for reactive, cross-skill event triggers. */
declare const hooks: {
  /** Register a hook that listens for events matching a declarative filter. */
  register(definition: HookDefinition): boolean;
  /** Unregister a previously registered hook by ID. */
  unregister(hookId: string): boolean;
  /** Update an existing hook's definition (partial merge). */
  update(hookId: string, changes: Partial<HookDefinition>): boolean;
  /** Enable or disable a hook without removing it. */
  setEnabled(hookId: string, enabled: boolean): boolean;
  /** List all hooks registered by this skill. */
  list(): HookRegistrationInfo[];
  /** Emit an event into the hooks system for other skills to react to. */
  emit(event: HookEvent): number;
  /** Get the current accumulation buffer state for a hook (for debugging). */
  getAccumulationState(hookId: string): HookAccumulationState | null;
};

/** OAuth credential management and authenticated API proxy. */
declare const oauth: {
  /** Get the OAuth credential for this skill, or null if not connected. */
  getCredential(): OAuthCredential | null;

  /**
   * Make an authenticated API request proxied through the server.
   * Server attaches the OAuth access_token and forwards to the provider API.
   * Path is relative to manifest's apiBaseUrl.
   */
  fetch(path: string, options?: OAuthFetchOptions): OAuthFetchResponse;

  /** Revoke the current OAuth credential server-side. */
  revoke(): boolean;
};

/** Advanced auth credential shape. */
interface AuthCredential {
  mode: 'managed' | 'self_hosted' | 'text';
  credentials: Record<string, unknown>;
}

/**
 * Advanced auth credential management.
 * Used when skills declare `setup.auth` in their manifest.
 * For managed mode, bridges to the OAuth system for backward compatibility.
 */
declare const auth: {
  /** Get the full auth credential, or null if not set. */
  getCredential(): AuthCredential | null;

  /** Get the auth mode string, or null. */
  getMode(): 'managed' | 'self_hosted' | 'text' | null;

  /** Get just the credentials map (e.g. { client_id, client_secret, url, content }). */
  getCredentials(): Record<string, unknown> | null;

  /**
   * Make an HTTP request with credentials auto-injected.
   * For self_hosted: auto-adds Authorization header from client_id/client_secret.
   * For managed: delegates to oauth.fetch.
   * For text: no auto-injection (skill should handle manually).
   */
  fetch(url: string, options?: OAuthFetchOptions): OAuthFetchResponse;
};

/** Memory insertion bridge (persists through native memory client). */
interface MemoryInsertParams {
  title: string;
  content: string;
  sourceType?: 'doc' | 'chat' | 'email';
  metadata?: Record<string, unknown>;
  priority?: 'high' | 'medium' | 'low';
  createdAt?: number;
  updatedAt?: number;
  documentId?: string;
}

/** Memory insertion bridge (persists through native memory client). */
declare const memory: {
  /** Insert skill-scoped memory payload to backend. */
  insert(params: MemoryInsertParams): boolean;
};

// ---------------------------------------------------------------------------
// Tools (assigned by skills on globalThis)
// ---------------------------------------------------------------------------

// /** Tool definitions exposed to the AI and other skills. */
// declare let tools: ToolDefinition[];

// ---------------------------------------------------------------------------
// QuickJS Runtime Globals (available at runtime but not in TypeScript by default)
// ---------------------------------------------------------------------------

/** Console logging (available in QuickJS runtime) */
declare const console: {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn(...args: any[]): void;
  info(...args: any[]): void;
};

/** Base64 encoding/decoding (available in QuickJS runtime) */
declare function atob(data: string): string;
declare function btoa(data: string): string;

/** URI encoding (available in QuickJS runtime) */
declare function encodeURIComponent(str: string): string;
declare function decodeURIComponent(str: string): string;

/** Timer functions (available in QuickJS runtime) */
declare function setTimeout(
  callback: (...args: any[]) => void,
  delay: number,
  ...args: any[]
): number;
declare function clearTimeout(id: number): void;
declare function setInterval(
  callback: (...args: any[]) => void,
  delay: number,
  ...args: any[]
): number;
declare function clearInterval(id: number): void;

/** AbortController for request cancellation (available in QuickJS runtime) */
declare class AbortController {
  readonly signal: AbortSignal;
  abort(): void;
}

declare class AbortSignal {
  readonly aborted: boolean;
  onabort: ((this: AbortSignal, ev: any) => any) | null;
}

// ---------------------------------------------------------------------------
// Supporting interfaces
// ---------------------------------------------------------------------------

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
  execute: (args: Record<string, unknown>) => string;
}

interface ToolInputSchema {
  type: 'object';
  properties: Record<string, ToolPropertySchema>;
  required?: string[];
}

interface ToolPropertySchema {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: { type: string; properties?: Record<string, any>; required?: string[] };
  properties?: Record<string, any>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  format?: string;
}

interface NetFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

interface NetFetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface SetupStep {
  id: string;
  title: string;
  description: string;
  fields: SetupField[];
}

interface SetupField {
  name: string;
  type: 'text' | 'select' | 'multiselect' | 'boolean' | 'number' | 'password';
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  options?: SetupFieldOption[];
}

interface SetupFieldOption {
  label: string;
  value: string;
}

interface SetupFieldError {
  field: string;
  message: string;
}

interface SetupStartResult {
  step: SetupStep;
}

interface SetupSubmitResult {
  status: 'next' | 'complete' | 'error';
  nextStep?: SetupStep;
  errors?: SetupFieldError[];
}

interface SkillOption {
  name: string;
  type: 'boolean' | 'text' | 'number' | 'select';
  label: string;
  description?: string;
  value: unknown;
  options?: SetupFieldOption[];
}

interface SkillInfo {
  id: string;
  name: string;
  version?: string;
  status?: string;
}

interface SummarySubmission {
  /** Main text summary. Must be non-empty. */
  summary: string;
  /** Key insights or bullet points. */
  keyPoints?: string[];
  /** Category (e.g. "market_update", "alert", "digest", "research", "activity"). */
  category?: string;
  /** Sentiment analysis result. */
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  /** Data source identifier (e.g. "telegram", "email", "on-chain", "api"). */
  dataSource: string;
  /** Time range covered, in epoch milliseconds. */
  timeRange?: { start: number; end: number };
  url?: string;
  /** Entities and relationships extracted from the data. */
  entities?: SummaryEntity[];
  /** Free-form metadata for skill-specific data. */
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface SummaryEntity {
  /** Entity identifier (username, email, wallet address, channel ID, etc.) */
  id: string;
  /** Data source identifier (e.g. "notionId", "telegramId", "emailId", "onChainId", "apiId"). */
  dataSourceId: string;
  /** Entity type. */
  type: 'person' | 'wallet' | 'channel' | 'group' | 'organization' | 'token' | 'other';
  /** Display name. */
  name?: string;
  /** Role/relationship in context (e.g. "sender", "recipient", "cc", "mentioned", "author"). */
  role?: string;
  /** Additional entity metadata. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Hook interfaces
// ---------------------------------------------------------------------------

/** Event emitted into the hooks system by emitter skills. */
interface HookEvent {
  /** Hierarchical event type: "<skill_id>.<entity>.<action>" */
  type: string;
  /** ID of the skill that emitted this event. */
  source: string;
  /** Epoch milliseconds when the event occurred. */
  timestamp: number;
  /** Named entities involved in the event (keyed by role: "chat", "sender", etc.). */
  entities: Record<string, HookEntityRef>;
  /** Event-specific payload data. */
  data: Record<string, unknown>;
}

/** Reference to an entity within a hook event. */
interface HookEntityRef {
  /** Entity type from entity_schema (e.g. "telegram.group"). */
  type: string;
  /** Entity ID. */
  id: string;
  /** Optional properties for richer matching. */
  properties?: Record<string, unknown>;
}

/**
 * Declarative filter — all top-level conditions are ANDed.
 * Fully JSON-serializable so the Rust runtime can evaluate without JS callbacks.
 */
interface HookFilter {
  /** Match event types (glob support: "telegram.message.*"). */
  event_types?: string[];
  /** Match by emitter skill ID. */
  source_skills?: string[];
  /** Match on entity roles (keyed by role name). */
  entities?: Record<string, HookEntityFilter>;
  /** Match on event data fields. */
  data_match?: HookDataMatch[];
  /** OR composition: at least one sub-filter must match. */
  any_of?: HookFilter[];
  /** AND composition: all sub-filters must match. */
  all_of?: HookFilter[];
  /** NOT composition: none of the sub-filters may match. */
  none_of?: HookFilter[];
}

/** Entity-specific filter within a HookFilter. */
interface HookEntityFilter {
  /** Match entity type(s). */
  types?: string[];
  /** Match entity ID(s). */
  ids?: string[];
  /** Match on entity properties. */
  properties?: HookDataMatch[];
}

/** Single comparison condition for data or property matching. */
interface HookDataMatch {
  /** Dot-path into the data object (e.g. "text", "is_outgoing"). */
  path: string;
  /** Comparison operator. */
  op:
    | 'eq'
    | 'neq'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'contains'
    | 'not_contains'
    | 'starts_with'
    | 'ends_with'
    | 'regex'
    | 'in'
    | 'not_in'
    | 'exists'
    | 'not_exists';
  /** Value to compare against (not needed for exists/not_exists). */
  value?: unknown;
}

/** Full hook registration provided to hooks.register(). */
interface HookDefinition {
  /** Unique ID within the skill (e.g. "reply-trigger"). */
  id: string;
  /** Human-readable description for UI/debugging. */
  description?: string;
  /** Declarative filter describing which events match. */
  filter: HookFilter;
  /** Optional accumulation/batching configuration. */
  accumulate?: HookAccumulation;
  /** Whether the hook is active (default: true). */
  enabled?: boolean;
  /** Auto-disable after this many fires. */
  max_fires?: number;
  /** Ordering priority when multiple hooks match (higher = first). */
  priority?: number;
}

/** Accumulation (batching) configuration for a hook. */
interface HookAccumulation {
  /** Fire after accumulating this many events. */
  count?: number;
  /** Time window in milliseconds for accumulation. */
  window_ms?: number;
  /** Dot-path for per-entity batching (e.g. "entities.chat.id"). */
  group_by?: string;
  /** Minimum events required before window-based trigger fires. */
  min_count?: number;
  /** Whether to reset the buffer after firing (default: true). */
  reset_on_fire?: boolean;
}

/** Arguments passed to onHookTriggered() when a hook fires. */
interface HookTriggeredArgs {
  /** The hook ID that fired. */
  hookId: string;
  /** The most recent event that caused the hook to fire. */
  event: HookEvent;
  /** All accumulated events in the batch. */
  events: HookEvent[];
  /** Total number of events in the batch. */
  eventCount: number;
  /** Accumulation group key value, if group_by was configured. */
  groupKey?: string;
  /** Epoch ms of the first event in this batch. */
  firstEventAt: number;
  /** Epoch ms when the hook actually fired. */
  triggeredAt: number;
}

/** Returned by onHookTriggered — describes actions for the runtime/frontend. */
interface HookActionResult {
  /** Actions to dispatch (interpreted by the runtime/frontend). */
  actions?: HookAction[];
  /** If true, suppress action dispatch (hook handled everything itself). */
  suppress?: boolean;
}

/** Generic action descriptor — the frontend/runtime interprets these. */
interface HookAction {
  /** Action type (e.g. "invoke_agent", "notify", "call_tool"). */
  type: string;
  /** Action-specific payload. */
  payload: Record<string, unknown>;
}

/** Information returned by hooks.list(). */
interface HookRegistrationInfo {
  /** Hook ID. */
  id: string;
  /** Whether the hook is currently enabled. */
  enabled: boolean;
  /** The hook's filter. */
  filter: HookFilter;
  /** Number of times this hook has fired. */
  fireCount: number;
  /** Epoch ms of last fire, or null if never fired. */
  lastFiredAt: number | null;
  /** Max fires limit, if set. */
  maxFires?: number;
  /** Priority value. */
  priority?: number;
  /** Whether accumulation is configured. */
  hasAccumulation: boolean;
}

/** Debug info for a hook's accumulation buffer, returned by hooks.getAccumulationState(). */
interface HookAccumulationState {
  /** Number of events currently buffered. */
  bufferedCount: number;
  /** Epoch ms timestamps of buffered events. */
  eventTimestamps: number[];
  /** Per-group buffer counts (if group_by is configured). */
  groups: Record<string, number>;
}

// ---------------------------------------------------------------------------
// OAuth interfaces
// ---------------------------------------------------------------------------

interface OAuthCredential {
  credentialId: string;
  provider: string;
  scopes: string[];
  isValid: boolean;
  createdAt: number;
  accountLabel?: string;
  /** When set (e.g. from frontend for Gmail), API calls use this token instead of the proxy. */
  accessToken?: string;
}

interface OAuthFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  baseUrl?: string;
}

interface OAuthFetchResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface OAuthCompleteArgs {
  credentialId: string;
  provider: string;
  grantedScopes: string[];
  accountLabel?: string;
}

interface OAuthCompleteResult {
  nextStep?: SetupStep;
}

interface OAuthRevokedArgs {
  credentialId: string;
  reason: 'user_disconnected' | 'token_expired' | 'provider_revoked' | 'server_error';
}

// ---------------------------------------------------------------------------
// Ping / health-check
// ---------------------------------------------------------------------------

interface PingResult {
  ok: boolean;
  errorType?: 'network' | 'auth';
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/** Arguments passed to onError() when an unhandled error occurs. */
interface SkillErrorArgs {
  /** Error category for structured handling. */
  type: 'network' | 'auth' | 'runtime' | 'timeout' | 'unknown';
  /** Human-readable error message. */
  message: string;
  /** The operation that failed (e.g. "setAuthenticationPhoneNumber", "fetch", "init"). */
  source?: string;
  /** Whether the error is recoverable (skill can retry). */
  recoverable?: boolean;
}

// ---------------------------------------------------------------------------
// OAuth lifecycle hooks
// ---------------------------------------------------------------------------

declare function onOAuthComplete(args: OAuthCompleteArgs): OAuthCompleteResult | void;
declare function onOAuthRevoked(args: OAuthRevokedArgs): void;

// ---------------------------------------------------------------------------
// Hook lifecycle hooks
// ---------------------------------------------------------------------------

/** Called when a registered hook's filter matches and accumulation conditions are met. */
declare function onHookTriggered(args: HookTriggeredArgs): HookActionResult | void;

// ---------------------------------------------------------------------------
// Error lifecycle hooks
// ---------------------------------------------------------------------------

/** Called when an unhandled error occurs during async operations. */
declare function onError(args: SkillErrorArgs): void;
