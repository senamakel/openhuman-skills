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

# Download local model for inference testing
yarn model:download

# Run test script with real local model
yarn test:model <skill-id> <script-file>
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
| `model`    | Local LLM inference (generate, summarize)           |

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

### Model (`model`)

```typescript
// Check if a local model is available
const available = model.isAvailable();
const status = model.getStatus(); // { available, loaded, loading, downloaded, error? }

// Generate text from a prompt
const response = model.generate('What is Bitcoin?', {
  maxTokens: 200, // default: 2048
  temperature: 0.7, // default: 0.7
  topP: 0.9, // default: 0.9
});

// Summarize a block of text
const summary = model.summarize(longText, { maxTokens: 100 });
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

Tests run against the **real Rust QuickJS runtime** via JSON-RPC. The test runner automatically builds, starts, and manages the runtime process.

### Prerequisites

The test pipeline requires two things to be built before tests can run:

```bash
# 1. Build the Rust runtime binary (openhuman-core)
yarn core:build
# Output: openhuman/target/debug/openhuman-core

# 2. Build compiled skill bundles from TypeScript
yarn build
# Output: skills/ directory
```

### How Tests Work

```
yarn test
  1. Discovers test files: src/core/**/__tests__/test-*.ts
  2. Kills any existing process on port 7799
  3. Spawns: openhuman-core skills run --skills-dir ./skills --port 7799
  4. Waits for GET /health to return 200 (30s timeout)
  5. Runs each test file via: npx tsx <test-file>
  6. Tests communicate with runtime via JSON-RPC POST to http://127.0.0.1:7799/rpc
  7. Aggregates results and kills runtime on exit
```

### Running Tests

```bash
# Run all unit tests
yarn test

# Run tests for a specific skill
yarn test src/core/server-ping/__tests__/test-server-ping.ts
yarn test server-ping    # shorthand: resolves to src/core/server-ping/__tests__/

# Run with verbose Rust logging
RUST_LOG=debug yarn test

# Run live integration scripts (require JWT_TOKEN)
JWT_TOKEN=<jwt> npx tsx src/core/gmail/live-test.ts
JWT_TOKEN=<jwt> npx tsx src/core/notion/live-test.ts
```

### Test Types

**Unit tests** (`src/core/<skill>/__tests__/test-<skill>.ts`):

- Run against the real runtime but don't require external credentials
- Test lifecycle (start/stop), setup flow, tool execution, DB operations
- Discovered automatically by `yarn test`

**Live integration scripts** (`src/core/<skill>/live-test.ts`):

- Run the full skill lifecycle with real API credentials
- Require `JWT_TOKEN` env var and optionally `BACKEND_URL`
- **Not** picked up by `yarn test` — must be run manually
- Support both OAuth and self-hosted auth modes

### Writing a Unit Test

```typescript
// src/core/my-skill/__tests__/test-my-skill.ts
import {
  afterAll,
  assertContains,
  assertEqual,
  assertNotNull,
  beforeAll,
  callTool,
  describe,
  getSkillStatus,
  it,
  run,
  setupStart,
  setupSubmit,
  startSkill,
  stopSkill,
} from '../../../../dev/test-harness';

const SKILL_ID = 'my-skill';

describe('Lifecycle', () => {
  it('should start successfully', async () => {
    const snap = await startSkill(SKILL_ID);
    assertEqual(snap.status, 'running');
  });

  afterAll(async () => {
    try {
      await stopSkill(SKILL_ID);
    } catch {}
  });
});

describe('Tools', () => {
  beforeAll(async () => {
    try {
      await stopSkill(SKILL_ID);
    } catch {}
    await startSkill(SKILL_ID);
  });

  it('should return data from tool', async () => {
    const result = (await callTool(SKILL_ID, 'get-status')) as any;
    assertNotNull(result);
  });

  afterAll(async () => {
    try {
      await stopSkill(SKILL_ID);
    } catch {}
  });
});

run(); // Required: executes all suites and exits
```

### Test Harness API (`dev/test-harness/index.ts`)

**Skill lifecycle:**

| Function                                            | Purpose                                       |
| --------------------------------------------------- | --------------------------------------------- |
| `startSkill(skillId)`                               | Start skill, returns snapshot (status, tools) |
| `stopSkill(skillId)`                                | Stop a running skill                          |
| `getSkillStatus(skillId)`                           | Get current state and tool list               |
| `callTool(skillId, toolName, args?)`                | Execute tool, returns parsed JSON result      |
| `callToolRaw(skillId, toolName, args?, timeoutMs?)` | Raw result with `is_error` + `content`        |

**Setup and auth:**

| Function                                                | Purpose                                |
| ------------------------------------------------------- | -------------------------------------- |
| `setupStart(skillId)`                                   | Begin setup wizard, returns first step |
| `setupSubmit(skillId, stepId, values)`                  | Submit a setup step                    |
| `setSetupComplete(skillId, complete)`                   | Mark setup as done                     |
| `oauthComplete(skillId, {credentialId, provider, ...})` | Complete managed OAuth flow            |
| `authComplete(skillId, mode, credentials)`              | Complete self-hosted auth              |

**Assertions:** `assert`, `assertEqual`, `assertNotNull`, `assertContains`, `assertGreaterThan`, `assertDeepEqual`, `assertThrows`, `assertMatch`, `assertArrayLength`

**Test structure:** `describe`, `it`, `beforeAll`, `afterAll`, `beforeEach`, `afterEach`, `run`

### Test Guidelines

- Tests that need a reachable URL should use `http://localhost:7799` (the running test runtime) rather than external domains
- Always stop skills in `afterAll` blocks to avoid leaking state between suites
- Tool calls default to 15s timeout; pass a higher value for slow operations: `callToolRaw(id, tool, args, 30000)`
- Test files must call `run()` at the end to execute suites and set exit code

### Rust Runtime Submodule

The Rust host binary lives in the `openhuman/` git submodule. To work with it:

```bash
# Build the debug binary
yarn core:build
# or: cargo build --manifest-path openhuman/Cargo.toml --bin openhuman-core

# Run the runtime manually (interactive, for debugging)
yarn dev:runtime
# or: yarn core:run

# Run with custom port
node scripts/dev-runtime.mjs --port 8080

# List discovered skills
yarn core:list

# Verbose Rust logging
RUST_LOG=debug yarn dev:runtime
RUST_LOG=trace yarn dev:runtime    # very verbose
```

The runtime exposes these HTTP endpoints on `http://127.0.0.1:7799`:

| Endpoint  | Method | Purpose                       |
| --------- | ------ | ----------------------------- |
| `/health` | GET    | Health check (200 when ready) |
| `/rpc`    | POST   | JSON-RPC 2.0 dispatch         |
| `/skills` | GET    | List running skills           |
| `/tools`  | GET    | List all tools across skills  |

### Manual Testing with curl

You can poke the runtime directly for debugging:

```bash
# Start runtime in one terminal
yarn dev:runtime

# Health check
curl http://127.0.0.1:7799/health

# List all skills
curl http://127.0.0.1:7799/skills

# List all tools
curl http://127.0.0.1:7799/tools

# Start a skill via JSON-RPC
curl -X POST http://127.0.0.1:7799/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"openhuman.skills_start","params":{"skill_id":"server-ping"}}'

# Call a tool via JSON-RPC
curl -X POST http://127.0.0.1:7799/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"openhuman.skills_call_tool","params":{"skill_id":"server-ping","tool_name":"get-ping-stats","args":{}}}'

# Get skill status
curl -X POST http://127.0.0.1:7799/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"openhuman.skills_status","params":{"skill_id":"server-ping"}}'

# Stop a skill
curl -X POST http://127.0.0.1:7799/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"openhuman.skills_stop","params":{"skill_id":"server-ping"}}'

# Trigger sync (for skills with sync support)
curl -X POST http://127.0.0.1:7799/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":5,"method":"openhuman.skills_sync","params":{"skill_id":"notion"}}'
```

### Interactive REPL

For interactive exploration of the runtime:

```bash
yarn repl
# Connects to http://127.0.0.1:7799 and provides an interactive prompt
# to call RPC methods, inspect skills, and test tools
```

### Environment Variables

Create a `.env` file in the repo root (see `.env.example`):

```bash
# Required for live integration scripts
JWT_TOKEN=<session-jwt-from-backend>
BACKEND_URL=https://api.tinyhumans.ai    # or staging URL

# OAuth credentials (for live tests)
NOTION_INTEGRATION_ID=<24-char-hex>
NOTION_CLIENT_KEY_SHARE=<base64>
GMAIL_INTEGRATION_ID=<24-char-hex>
GMAIL_CLIENT_KEY_SHARE=<base64>

# Self-hosted auth (alternative to OAuth)
AUTH_MODE=self_hosted
GMAIL_CLIENT_ID=<google-client-id>
GMAIL_CLIENT_SECRET=<google-client-secret>
GMAIL_REFRESH_TOKEN=<refresh-token>
NOTION_API_KEY=<ntn_...>
```

The dev runtime (`yarn dev:runtime`) automatically loads `.env`. The test runner passes `process.env` through, so export vars or use `dotenv` in test scripts.

### Troubleshooting

| Problem                                    | Fix                                                                                |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| "openhuman-core binary not found"          | Run `yarn core:build`                                                              |
| "compiled skills not found"                | Run `yarn build`                                                                   |
| "Runtime failed to start within 30s"       | Run `RUST_LOG=debug yarn test` to see startup errors                               |
| "Port 7799 already in use"                 | Run `lsof -ti:7799 \| xargs kill -9`                                               |
| Tool call timeout                          | Increase timeout: `callToolRaw(id, tool, args, 30000)`                             |
| Setup test fails with "error" on valid URL | The setup may validate reachability; use `http://localhost:7799` as the target URL |

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
- **Synchronous execution** — No async/await; `net.fetch()` is sync with timeout
- **JSON string results** — Tool execute functions must return JSON strings
- **6-field cron** — Cron includes seconds: `sec min hour day month dow`
- **SQL params required** — Always use `?` placeholders, never interpolation
- **No underscores in skill names** — Use lowercase-hyphens (e.g., `my-skill`)
- **Isolated data** — Skills cannot access other skills' databases or files
- **Globals via globalThis** — Tools must access shared state via `globalThis.getSkillState()`, not bare variable names (see Skill State Management pattern)

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
  onProgress?.('Fetching items...');

  let cursor: string | undefined;
  let totalSynced = 0;
  do {
    const result = api.fetchItems(s.config.apiKey, cursor);
    for (const item of result.items) {
      globalThis.mySkillDb.upsertItem(item);
      totalSynced++;
    }
    cursor = result.nextCursor;
    onProgress?.(`Synced ${totalSynced} items...`);
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
    lastSync: db.get("SELECT value FROM sync_state WHERE key = 'last_sync'", [])?.value ?? null,
    itemCount: (db.get('SELECT COUNT(*) as count FROM items', []) as { count: number })?.count ?? 0,
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
