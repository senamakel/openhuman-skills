# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Summary

This is the **OpenHuman Skills** repository — a plugin/extension system for the OpenHuman AI agent. Skills extend the agent with domain-specific capabilities for the crypto community platform. This repo is a git submodule of the main OpenHuman Tauri app.

## PR Template Requirement

- Use `.github/pull_request_template.md` from the main repository for every PR description.
- AI tooling must preserve the template section order and include all checklist items.

## Architecture

Skills are written in **TypeScript** and compiled to **JavaScript** for execution in a sandboxed **QuickJS** runtime embedded in the Rust host application.

### Directory Structure

```
skills/                          # Repo root
├── src/                         # TypeScript source files
│   ├── example-skill/           # Comprehensive example (kitchen sink)
│   ├── server-ping/             # Server health monitoring skill
│   ├── simple-skill/            # Minimal skill template
│   ├── gmail/                   # Gmail integration
│   ├── notion/                  # Notion API integration
│   └── telegram/                # Telegram integration
├── skills/                      # Compiled JavaScript output (git-ignored)
├── types/
│   └── globals.d.ts             # Ambient type declarations for bridge APIs
├── dev/
│   └── test-harness/            # Node.js test harness (tsx)
│       ├── runner-node.ts       # Test runner
│       ├── bootstrap-node.ts    # Mock bridge APIs
│       ├── live-runner-node.ts  # Live test runner
│       ├── mock-state.ts        # Mock state management
│       └── mock-db.ts           # Mock SQLite database
├── scripts/
│   ├── build-bundle.mjs         # esbuild bundler
│   ├── strip-exports.mjs        # Post-build processing
│   ├── validate.mjs             # Skill validation checks
│   ├── scan-secrets.mjs         # Secret scanner
│   ├── install-skill-deps.mjs   # Per-skill dependency installer
│   └── test-harness.mjs         # Test orchestrator
├── package.json                 # Build scripts
├── tsconfig.json                # Base TypeScript config
├── tsconfig.build.json          # Production build config
└── tsconfig.test.json           # Test build config
```

### Skill Structure

Each skill is a directory under `src/` with a modular file layout. Keep concerns separated into dedicated files and folders:

```
src/my-skill/
├── manifest.json           # Metadata (id, name, version, runtime, platforms, setup, events, entity schema)
├── index.ts                # Entry point — lifecycle hooks, imports all modules, wires everything together
├── types.ts                # All TypeScript type/interface definitions for the skill
├── state.ts          # Shared mutable state via globalThis pattern
├── setup.ts                # Multi-step setup wizard (onSetupStart, onSetupSubmit logic)
├── sync.ts                 # Initial data sync and periodic refresh logic
├── update-handlers.ts      # Event/update dispatch handlers (if skill has real-time updates)
├── db/
│   ├── schema.ts           # SQLite CREATE TABLE statements, indexes, migrations
│   └── helpers.ts          # Upsert, query, and data extraction utilities
├── api/
│   ├── index.ts            # Barrel re-export of all API functions
│   ├── auth.ts             # Authentication API calls
│   ├── messages.ts         # Messaging API calls
│   ├── chats.ts            # Chat/channel API calls
│   └── ...                 # One file per API domain
├── tools/
│   ├── index.ts            # Barrel re-export of all tool definitions
│   ├── send-message.ts     # Individual tool definition + execute function
│   ├── get-chats.ts
│   └── ...                 # One file per tool (or per logical group)
├── package.json            # (optional) Per-skill npm dependencies
└── __tests__/
    └── test-my-skill.ts    # Unit tests
```

**Key principles:**

- **`index.ts` is the orchestrator** — it imports all modules, implements lifecycle hooks (`init`, `start`, `stop`, etc.), assembles the `tools` array, and exposes helper functions on `globalThis`
- **`state.ts` owns the state** — defines the state interface, initializes defaults, and registers `globalThis.getSkillState()`
- **`setup.ts` owns the setup wizard** — all `onSetupStart`/`onSetupSubmit` logic lives here, imported by `index.ts`
- **`sync.ts` owns data synchronization** — initial sync, periodic refresh, progress tracking
- **`types.ts` owns all types** — shared interfaces, API response types, database row types
- **`db/schema.ts`** — all `CREATE TABLE` / `CREATE INDEX` statements
- **`db/helpers.ts`** — upsert functions, query helpers, data extraction/parsing utilities
- **`api/`** — one file per API domain, each exporting pure functions that make API calls; barrel-exported from `api/index.ts`
- **`tools/`** — one file per tool (or per logical group), each exporting a `ToolDefinition`; barrel-exported from `tools/index.ts`
- **`update-handlers.ts`** — dispatches incoming events/updates to the right handlers (optional, for real-time integrations)

For simple skills that don't need all of these, you can start with just `manifest.json`, `index.ts`, and `state.ts`, then split into more files as complexity grows.

### manifest.json

```json
{
  "id": "my-skill",
  "name": "My Skill",
  "runtime": "quickjs",
  "entry": "index.js",
  "version": "1.0.0",
  "description": "What this skill does",
  "auto_start": false,
  "platforms": ["windows", "macos", "linux"],
  "setup": { "required": true, "label": "Configure My Skill" }
}
```

## Build Commands

```bash
# Install dependencies
yarn install

# Full build: clean, install skill deps, compile TypeScript, bundle, post-process
yarn build

# Type checking only (no emit)
yarn typecheck

# Watch mode for development
yarn build:watch

# Validate skills (manifest, secrets, code quality)
yarn validate

# Secret scanning only
yarn validate:secrets

# Run all tests
yarn test

# Run specific test
yarn test src/server-ping/__tests__/test-server-ping.ts

# Lint and format
yarn lint
yarn format:check
```

## Bridge APIs

Skills have access to these global namespaces (defined in `types/globals.d.ts`):

| Namespace  | Purpose                                             |
| ---------- | --------------------------------------------------- |
| `db`       | SQLite database scoped to skill                     |
| `net`      | HTTP networking (synchronous)                       |
| `cron`     | Cron scheduling (6-field syntax)                    |
| `skills`   | Inter-skill communication                           |
| `platform` | OS info, env vars, notifications                    |
| `state`    | Persistent key-value store + real-time frontend pub |
| `data`     | File I/O in skill's data directory                  |

### Database (`db`)

```typescript
db.exec('CREATE TABLE IF NOT EXISTS logs (...)', []);
db.exec('INSERT INTO logs (msg) VALUES (?)', ['hello']);
const row = db.get('SELECT * FROM logs WHERE id = ?', [1]);
const rows = db.all('SELECT * FROM logs LIMIT 10', []);
db.kvSet('key', { any: 'value' });
const value = db.kvGet('key');
```

### HTTP (`net`)

```typescript
const response = net.fetch('https://api.example.com/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'test' }),
  timeout: 10000,
});
// response: { status: number, headers: Record<string, string>, body: string }
```

### Cron (`cron`)

```typescript
// 6-field syntax: seconds minutes hours day month dow
cron.register('every-10s', '*/10 * * * * *');
cron.unregister('every-10s');
const schedules = cron.list();
```

### State (`state`)

Unified persistent key-value store that also publishes values to the frontend in real time.

```typescript
state.set('config', { apiKey: 'xxx' }); // Persists AND publishes to frontend
const config = state.get('config'); // Read from persistent store
state.setPartial({ lastPing: Date.now() }); // Bulk set (persists + publishes each key)
state.delete('config'); // Remove from persistent store
const keys = state.keys(); // List all persisted keys
```

### Data (`data`)

```typescript
data.write('config.json', JSON.stringify(config, null, 2));
const content = data.read('config.json'); // null if not found
```

### Platform (`platform`)

```typescript
const os = platform.os(); // "windows", "macos", "linux", "android", "ios"
const apiKey = platform.env('MY_API_KEY');
platform.notify('Title', 'Body');
```

### Skills Interop (`skills`)

```typescript
const allSkills = skills.list();
const result = skills.callTool('other-skill', 'tool-name', { arg: 'value' });
```

## Lifecycle Hooks

Skills implement these functions (all synchronous):

```typescript
function init(): void; // Load config, create DB tables
function start(): void; // Register cron schedules, begin work
function stop(): void; // Cleanup, persist state
function onCronTrigger(scheduleId: string): void; // Handle cron triggers
function onSessionStart(args: { sessionId: string }): void; // User started conversation
function onSessionEnd(args: { sessionId: string }): void; // Conversation ended
function onSetupStart(): SetupStartResult; // Return first setup step
function onSetupSubmit(args): SetupSubmitResult; // Process setup step
function onSetupCancel(): void; // Cleanup on cancel
function onDisconnect(): void; // User disconnected skill
function onListOptions(): { options: SkillOption[] }; // Runtime options
function onSetOption(args: { name: string; value: unknown }): void;
```

### Lifecycle Flow

```
Skill Load ── init()
                │
        ┌── start()
        │       │
        │   onCronTrigger(scheduleId) ← fires on schedule
        │       │
        │   onSessionStart/End
        │       │
        └── stop()
```

## Tool Registration

Tools are exposed to the AI via the global `tools` array:

```typescript
tools = [
  {
    name: 'get-status',
    description: 'Get current skill status',
    input_schema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['json', 'text'], description: 'Output format' },
      },
      required: [],
    },
    execute(args): string {
      // Must return JSON string
      return JSON.stringify({ status: 'ok', uptime: 99.9 });
    },
  },
];
```

**Important**: Tool `execute` functions must return **JSON strings**, not objects.

## Setup Flow

Multi-step configuration wizard:

```typescript
function onSetupStart(): SetupStartResult {
  return {
    step: {
      id: "credentials",
      title: "API Credentials",
      description: "Enter your credentials",
      fields: [
        { name: "apiKey", type: "password", label: "API Key", required: true },
        { name: "region", type: "select", label: "Region", options: [...] },
      ],
    },
  };
}

function onSetupSubmit(args: { stepId: string; values: Record<string, unknown> }): SetupSubmitResult {
  if (args.stepId === "credentials") {
    if (!args.values.apiKey) {
      return { status: "error", errors: [{ field: "apiKey", message: "Required" }] };
    }
    // Multi-step: return next step
    return { status: "next", nextStep: { id: "step2", ... } };
    // Or complete:
    return { status: "complete" };
  }
}
```

Field types: `text`, `password`, `number`, `select`, `boolean`.

## Options System

Runtime-configurable settings:

```typescript
function onListOptions(): { options: SkillOption[] } {
  return {
    options: [
      {
        name: 'interval',
        type: 'select',
        label: 'Check Interval',
        value: String(CONFIG.interval),
        options: [
          { label: 'Every 10s', value: '10' },
          { label: 'Every 30s', value: '30' },
        ],
      },
    ],
  };
}

function onSetOption(args: { name: string; value: unknown }): void {
  if (args.name === 'interval') {
    CONFIG.interval = parseInt(args.value as string);
    // Update cron schedule
    cron.unregister('work');
    cron.register('work', `*/${CONFIG.interval} * * * * *`);
  }
}
```

## Testing

Tests use a Node.js harness (tsx) with mocked bridge APIs.

### Test Structure

```typescript
// src/my-skill/__tests__/test-my-skill.ts

function freshInit(overrides?: Partial<Config>): void {
  setupSkillTest({
    stateData: { config: { ...defaultConfig, ...overrides } },
    fetchResponses: { 'https://api.example.com': { status: 200, body: '{"ok":true}' } },
  });
  init();
}

_describe('My Skill', () => {
  _it('should initialize', () => {
    freshInit();
    _assertNotNull(state.get('config'));
  });

  _it('should call API', () => {
    freshInit({ apiKey: 'test' });
    start();
    const result = callTool('get-status', {});
    _assertEqual(result.status, 'ok');
  });
});
```

### Test Helpers

```typescript
setupSkillTest(options?: {
  stateData?: Record<string, unknown>;
  fetchResponses?: Record<string, { status: number; body: string }>;
  env?: Record<string, string>;
  platformOs?: string;
});

callTool(name: string, args?: Record<string, unknown>): unknown;
getMockState(): { state, fetchCalls, notifications, cronSchedules, ... };
mockFetchResponse(url: string, status: number, body: string): void;
mockFetchError(url: string, message?: string): void;
```

### Running Tests

```bash
# Run all tests
yarn test

# Run specific test
yarn test src/server-ping/__tests__/test-server-ping.ts

# Compile only (for debugging)
npx tsc -p tsconfig.test.json
```

## Creating a New Skill

1. Create directory structure:

```bash
mkdir -p src/my-skill/{api,tools,db,__tests__}
```

2. Create `manifest.json`:

```json
{
  "id": "my-skill",
  "name": "My Skill",
  "runtime": "quickjs",
  "entry": "index.js",
  "version": "1.0.0",
  "description": "What this skill does",
  "platforms": ["windows", "macos", "linux"],
  "setup": { "required": true, "label": "Configure My Skill" }
}
```

3. Create the core files in this order:
   - `types.ts` — all type definitions
   - `state.ts` — state interface + globalThis registration
   - `db/schema.ts` — CREATE TABLE statements + globalThis registration
   - `db/helpers.ts` — upsert/query functions + globalThis registration
   - `api/*.ts` — API functions per domain + `api/index.ts` barrel export
   - `tools/*.ts` — one tool per file + `tools/index.ts` barrel export
   - `setup.ts` — setup wizard steps
   - `sync.ts` — data sync logic + globalThis registration
   - `index.ts` — lifecycle hooks, imports all modules, assembles `tools` array

4. (Optional) Add per-skill dependencies by creating a `package.json` in your skill directory:

```json
{
  "name": "@openhuman/skill-my-skill",
  "private": true,
  "dependencies": { "some-library": "^1.0.0" }
}
```

Only `dependencies` are bundled — esbuild inlines them into the single output file.

5. Build, validate, and test:

```bash
yarn build
yarn typecheck
yarn validate
yarn test src/my-skill/__tests__/test-my-skill.ts
```

See [`src/telegram/`](src/telegram/) for the reference implementation demonstrating the full modular pattern with API layer, 50+ tools, database schema/helpers, setup wizard, sync, and state management.

## Key Constraints

- **TypeScript only** — Skills are TypeScript compiled to JavaScript
- **QuickJS runtime** — Sandboxed JS environment with bridge APIs
- **ES2019 target** — esbuild bundles with `target: 'es2019'`. **Do NOT use optional chaining (`?.`) or nullish coalescing (`??`) in skill code** — QuickJS does not support them and they will crash the event loop silently. Use ternary/`||` instead: `x ? x.y : null` not `x?.y`, `x !== null && x !== undefined ? x : fallback` not `x ?? fallback`.
- **JSON string results** — Tool execute functions must return JSON strings
- **No raw text in published state** — `state.setPartial()` values pass through JSON-RPC transport. Raw text content (page bodies, email bodies) with newlines or special characters will break the JSON envelope. Only publish metadata (id, title, date) — never `content_text` or `body_text`.
- **Tool logging** — All tools should be wrapped with `withLogging()` in `tools/index.ts`. This logs entry (tool name + args), exit (timing + result size), and errors for every call. See Notion or Gmail tools for the pattern.
- **Sync is fire-and-forget** — The Rust event loop's `skill/sync` RPC starts `onSync()` as a background task and returns immediately. Sync progress should be published via `state.setPartial()` with `syncPhase`, `syncProgress` (0-100), and `syncMessage` fields. The `sync-status` tool exposes these to callers.
- **MIN_CONTENT_LENGTH for ingestion** — When calling `memory.insert()`, skip content shorter than 50 characters. Very short strings crash the embedding model (ONNX/CoreML shape {0}).
- **6-field cron** — Cron includes seconds: `sec min hour day month dow`
- **SQL params required** — Always use `?` placeholders, never interpolation
- **No underscores in skill names** — Use lowercase-hyphens (e.g., `my-skill`)
- **Isolated data** — Skills cannot access other skills' databases or files
- **Globals via globalThis** — Tools must access shared state via `globalThis.getSkillState()`, not bare variable names (see Skill State Management pattern)

## OAuth Proxy

Skills using OAuth (managed mode) make API calls via `oauth.fetch()`, which proxies through the backend at `/proxy/encrypted/:integrationId/:path`. The backend proxy sets provider-specific headers (e.g. `Notion-Version`). For the Notion skill, the API version is hardcoded to `2026-03-11` in `notionFetch()` via the `NOTION_API_VERSION` constant — skills cannot override it through headers. The `X-Encryption-Key` header carries the client key share for token decryption. JWT for auth comes from `__ops.get_session_token()` (reads on-disk credential store, falls back to `JWT_TOKEN` env var).

### Test Harness RPC Methods

The Rust event loop matches these exact RPC method strings — use them in test harness calls:

| Method           | What it does                                  |
| ---------------- | --------------------------------------------- |
| `oauth/complete` | Inject OAuth credential + client key share    |
| `auth/complete`  | Inject self-hosted credential with validation |
| `skill/sync`     | Fire-and-forget background sync               |
| `skill/ping`     | Health check                                  |
| `oauth/revoked`  | Clear OAuth credential                        |
| `auth/revoked`   | Clear auth credential                         |

## Build Process

1. **Install skill dependencies**: `node scripts/install-skill-deps.mjs`
   - Runs `yarn install` in each `src/<skill>/` that has a `package.json`

2. **TypeScript Compilation**: `tsc -p tsconfig.build.json`
   - Input: `src/*/index.ts`
   - Output: `skills/*/index.js`

3. **esbuild Bundling**: `node scripts/build-bundle.mjs`
   - Bundles each skill into a single IIFE file with all dependencies inlined

4. **Post-Processing** (`strip-exports.mjs`):
   - Removes `export {};` module boundaries
   - Normalizes indentation (4-space → 2-space)
   - Copies `manifest.json` to output

5. **Output**: Ready-to-run JavaScript in `skills/`

## Common Patterns

### Skill State Management (`state.ts`)

All skills must use the **globalThis state pattern** for cross-module state access. This ensures state works in both the bundled esbuild IIFE (production) and the test harness.

```typescript
// state.ts
import type { MyConfig } from './types';

export interface MySkillState {
  config: MyConfig;
  isRunning: boolean;
  cache: { items: Map<string, unknown> };
}

declare global {
  function getMySkillState(): MySkillState;
  var __mySkillState: MySkillState;
}

const skillState: MySkillState = {
  config: { apiKey: '', region: 'us' },
  isRunning: false,
  cache: { items: new Map() },
};
globalThis.__mySkillState = skillState;

globalThis.getMySkillState = function (): MySkillState {
  return globalThis.__mySkillState;
};
```

**Why this pattern:** Bundled skills use esbuild IIFE format (module-local scopes) and the test harness uses `new Function()`. Accessing state via `globalThis.getMySkillState()` works in both environments.

### Types (`types.ts`)

All type definitions for the skill live in a single `types.ts` file:

```typescript
// types.ts

// Config stored in state.set('config', ...)
export interface MyConfig {
  apiKey: string;
  region: string;
  syncEnabled: boolean;
}

// API response types
export interface ApiItem {
  id: string;
  title: string;
  updatedAt: string;
}

// Database row types
export interface ItemRow {
  id: string;
  title: string;
  content: string;
  synced_at: string;
}
```

### Database Schema (`db/schema.ts`)

All `CREATE TABLE` and `CREATE INDEX` statements in one place:

```typescript
// db/schema.ts

export function initializeSchema(): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT,
    content_type TEXT DEFAULT 'text',
    synced_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
    []
  );

  db.exec(`CREATE INDEX IF NOT EXISTS idx_items_synced_at ON items(synced_at)`, []);

  db.exec(
    `CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
    []
  );
}

// Register on globalThis for access from index.ts
declare global {
  var initializeMySkillSchema: () => void;
}
globalThis.initializeMySkillSchema = initializeSchema;
```

### Database Helpers (`db/helpers.ts`)

Upsert, query, and data extraction utilities:

```typescript
// db/helpers.ts

export function upsertItem(item: ApiItem): void {
  db.exec(
    `INSERT INTO items (id, title, content, synced_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title=?, content=?, synced_at=?`,
    [item.id, item.title, item.content, item.updatedAt, item.title, item.content, item.updatedAt]
  );
}

export function getItemById(id: string): ItemRow | null {
  return db.get('SELECT * FROM items WHERE id = ?', [id]) as ItemRow | null;
}

export function searchItems(query: string, limit: number = 20): ItemRow[] {
  return db.all('SELECT * FROM items WHERE title LIKE ? OR content LIKE ? LIMIT ?', [
    `%${query}%`,
    `%${query}%`,
    limit,
  ]) as ItemRow[];
}

// Register on globalThis
declare global {
  var mySkillDb: {
    upsertItem: typeof upsertItem;
    getItemById: typeof getItemById;
    searchItems: typeof searchItems;
  };
}
globalThis.mySkillDb = { upsertItem, getItemById, searchItems };
```

### API Layer (`api/`)

One file per API domain with pure functions. Barrel-export from `api/index.ts`:

```typescript
// api/items.ts
export function fetchItems(
  apiKey: string,
  cursor?: string
): { items: ApiItem[]; nextCursor?: string } {
  const url = `https://api.example.com/items${cursor ? `?cursor=${cursor}` : ''}`;
  const response = net.fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  if (response.status >= 400) throw new Error(`API error: ${response.status}`);
  return JSON.parse(response.body);
}

// api/index.ts — barrel export
export { fetchItems, createItem, updateItem } from './items';
export { authenticate, refreshToken } from './auth';
```

### Tools (`tools/`)

One file per tool (or per logical group). Each exports a `ToolDefinition`:

```typescript
// tools/search-items.ts
import type { ToolDefinition } from '../../types/globals';

export const searchItemsTool: ToolDefinition = {
  name: 'search-items',
  description: 'Search items by keyword',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results (default 20)' },
    },
    required: ['query'],
  },
  execute(args: Record<string, unknown>): string {
    const query = args.query as string;
    const limit = (args.limit as number) || 20;
    const results = globalThis.mySkillDb.searchItems(query, limit);
    return JSON.stringify({ success: true, results, count: results.length });
  },
};

// tools/index.ts — barrel export
export { searchItemsTool } from './search-items';
export { getItemTool } from './get-item';
export { createItemTool } from './create-item';
```

### Setup Wizard (`setup.ts`)

Multi-step configuration wizard, imported by `index.ts`:

```typescript
// setup.ts
export function onSetupStart(): SetupStartResult {
  const s = globalThis.getMySkillState();
  // If already have a key, show it masked
  return {
    step: {
      id: 'credentials',
      title: 'API Credentials',
      description: 'Enter your API key',
      fields: [
        { name: 'apiKey', type: 'password', label: 'API Key', required: true },
        {
          name: 'region',
          type: 'select',
          label: 'Region',
          options: [
            { label: 'US', value: 'us' },
            { label: 'EU', value: 'eu' },
          ],
        },
      ],
    },
  };
}

export function onSetupSubmit(args: {
  stepId: string;
  values: Record<string, unknown>;
}): SetupSubmitResult {
  if (args.stepId === 'credentials') {
    const apiKey = args.values.apiKey as string;
    if (!apiKey) return { status: 'error', errors: [{ field: 'apiKey', message: 'Required' }] };
    // Validate key works
    try {
      const result = api.authenticate(apiKey);
      const s = globalThis.getMySkillState();
      s.config.apiKey = apiKey;
      s.config.region = (args.values.region as string) || 'us';
      state.set('config', s.config);
      return { status: 'complete' };
    } catch (e) {
      return { status: 'error', errors: [{ field: 'apiKey', message: 'Invalid API key' }] };
    }
  }
  return { status: 'error', errors: [{ field: '', message: 'Unknown step' }] };
}
```

### Sync Logic (`sync.ts`)

Initial data sync and periodic refresh:

```typescript
// sync.ts
export function performInitialSync(onProgress?: (msg: string) => void): void {
  const s = globalThis.getMySkillState();
  if (onProgress) onProgress('Fetching items...');

  let cursor: string | undefined;
  let totalSynced = 0;
  do {
    const result = api.fetchItems(s.config.apiKey, cursor);
    for (const item of result.items) {
      globalThis.mySkillDb.upsertItem(item);
      totalSynced++;
    }
    cursor = result.nextCursor;
    if (onProgress) onProgress(`Synced ${totalSynced} items...`);
  } while (cursor);

  db.exec(`INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_sync', ?)`, [
    new Date().toISOString(),
  ]);
}

// Register on globalThis
declare global {
  var mySkillSync: { performInitialSync: typeof performInitialSync };
}
globalThis.mySkillSync = { performInitialSync };
```

### Entry Point (`index.ts`)

The orchestrator that wires everything together:

```typescript
// index.ts — import order matters
// 4. Sync registration
import * as api from './api';
// 2. DB schema registration
import './db/helpers';
// 1. State first
import './db/schema';
// 5. API layer
import { onSetupStart, onSetupSubmit } from './setup';
import './skill-state';
// 3. DB helpers registration
import './sync';
import { createItemTool, getItemTool, searchItemsTool } from './tools';

function init(): void {
  globalThis.initializeMySkillSchema();
  const s = globalThis.getMySkillState();
  const saved = state.get('config');
  if (saved) s.config = { ...s.config, ...(saved as Partial<MyConfig>) };
}

function start(): void {
  const s = globalThis.getMySkillState();
  if (s.config.apiKey) {
    globalThis.mySkillSync.performInitialSync();
    cron.register('refresh', '0 */5 * * * *'); // every 5 min
  }
  s.isRunning = true;
  publishState();
}

function stop(): void {
  const s = globalThis.getMySkillState();
  s.isRunning = false;
  cron.unregister('refresh');
  state.set('config', s.config);
}

function onCronTrigger(scheduleId: string): void {
  if (scheduleId === 'refresh') {
    globalThis.mySkillSync.performInitialSync();
    publishState();
  }
}

function publishState(): void {
  const s = globalThis.getMySkillState();
  state.setPartial({
    connection_status: s.isRunning ? 'connected' : 'disconnected',
    is_initialized: true,
  });
}

// Expose for tools
const _g = globalThis as Record<string, unknown>;
_g.publishState = publishState;

tools = [searchItemsTool, getItemTool, createItemTool];
```

### globalThis Registration Summary

Every module that needs cross-module access registers on `globalThis`:

| Module          | Registers                              | Purpose                     |
| --------------- | -------------------------------------- | --------------------------- |
| `state.ts`      | `globalThis.getMySkillState()`         | State access                |
| `db/schema.ts`  | `globalThis.initializeMySkillSchema()` | Schema creation             |
| `db/helpers.ts` | `globalThis.mySkillDb.*`               | DB operations               |
| `sync.ts`       | `globalThis.mySkillSync.*`             | Sync operations             |
| `index.ts`      | `globalThis.publishState()` etc.       | Lifecycle helpers for tools |

### State Publishing

Always publish state to the frontend via `state.setPartial()`:

```typescript
function publishState(): void {
  const s = globalThis.getMySkillState();
  state.setPartial({
    connection_status: s.isRunning ? 'connected' : 'disconnected',
    is_initialized: true,
    lastSync: (() => {
      const row = db.get("SELECT value FROM sync_state WHERE key = 'last_sync'", []);
      return row ? row.value : null;
    })(),
    itemCount: (() => {
      const row = db.get('SELECT COUNT(*) as count FROM items', []) as { count: number } | null;
      return row ? row.count : 0;
    })(),
  });
}
```

### Error Handling with Notifications

```typescript
function onCronTrigger(scheduleId: string): void {
  if (scheduleId === 'refresh') {
    try {
      globalThis.mySkillSync.performInitialSync();
      publishState();
    } catch (e) {
      console.error(`Sync error: ${e}`);
      platform.notify('Sync Failed', String(e));
    }
  }
}
```

## Type Definitions

All bridge API types are in `types/globals.d.ts`. Key interfaces:

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
  execute: (args: Record<string, unknown>) => string;
}

interface SetupStep {
  id: string;
  title: string;
  description: string;
  fields: SetupField[];
}

interface SetupField {
  name: string;
  type: 'text' | 'select' | 'boolean' | 'number' | 'password';
  label: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  options?: SetupFieldOption[];
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
  value: unknown;
  options?: SetupFieldOption[];
}
```

## Legacy Python Skills

The `skills-py/` directory contains legacy Python skills that are being migrated to TypeScript. Do not create new Python skills — all new skills should be TypeScript.
