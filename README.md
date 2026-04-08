# OpenHuman Skills

This repository is the **canonical skills registry** for [OpenHuman](https://github.com/tinyhumansai/openhuman): TypeScript packages that extend the desktop agent with tools, integrations, and background behavior. Skills are authored here, built into JavaScript bundles, and loaded by the OpenHuman core inside a **sandboxed QuickJS** runtime.

The **OpenHuman application** (Tauri + React + Rust) lives in the main [`openhuman`](https://github.com/tinyhumansai/openhuman) repo. This repo holds only skill sources, build tooling, tests, and documentation for skills.

---

## What skills are

A **skill** is a self-contained module that:

- Declares **metadata** in `manifest.json` (id, version, description, setup, platforms, optional auth).
- Exposes **tools** the AI can call (each returns a JSON string).
- Implements **lifecycle hooks** such as `init`, `start`, `stop`, optional setup wizards, and cron handlers.
- Uses **bridge APIs** provided by the host: SQLite (`db`), HTTP (`net`), persistent state (`state`), files (`data`), scheduling (`cron`), notifications (`platform`), optional local model (`model`), and more.

Execution is **synchronous** (no `async`/`await` in skill code). Networking uses `net.fetch` with timeouts. Each skill gets an isolated SQLite database and storage; credentials belong in setup flows or environment, never hardcoded.

See **[`docs/SKILLS.md`](docs/SKILLS.md)** for a full overview and **[`docs/SKILL_SPEC.md`](docs/SKILL_SPEC.md)** for integration checklists and file layout conventions.

## Repository layout

| Path                                     | Purpose                                                                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [`src/core/<skill-id>/`](src/core/)      | One directory per shipped skill (`index.ts`, `manifest.json`, optional `tools/`, `api/`, `db/`, `__tests__/`, etc.)     |
| [`src/helpers/`](src/helpers/)           | Shared helpers imported by skills                                                                                       |
| [`src/shared/`](src/shared/)             | Shared cross-skill metadata utilities                                                                                   |
| [`types/`](types/)                       | Ambient types for bridge APIs (e.g. globals used by skills)                                                             |
| [`scripts/`](scripts/)                   | Install per-skill deps, TypeScript compile, esbuild bundle, strip exports, registry generation, validation, secret scan |
| [`dev/test-harness/`](dev/test-harness/) | Node test harness, REPL, and mocks for local development                                                                |
| [`docs/`](docs/)                         | Long-form guides (`SKILLS.md`, `SKILL_SPEC.md`, …)                                                                      |
| `skills/`                                | **Build output** (generated; gitignored) — bundled JS + `manifest.json` per skill                                       |
| `skills-ts-out/`                         | Intermediate TypeScript emit (gitignored)                                                                               |
| [`openhuman/`](openhuman/)               | Optional **git submodule** to the main OpenHuman app for local end-to-end work                                          |

A typical skill directory (larger skills split into modules):

```text
src/core/<skill-id>/
├── manifest.json
├── index.ts              # Lifecycle + wiring
├── types.ts              # Types for this skill
├── state.ts              # Optional globalThis state pattern
├── setup.ts              # Optional setup wizard
├── tools/
│   ├── index.ts          # Barrel export
│   └── <tool>.ts         # One file per tool or group
├── db/                   # Optional schema + helpers
├── api/                  # Optional HTTP/API layer
└── __tests__/
    └── test-<skill>.ts
```

## Build and quality commands

Prerequisites: **Node.js 22+** and **Yarn**.

```bash
yarn install
yarn build          # clean, per-skill deps, tsc, bundle, strip, registry
yarn typecheck
yarn test           # smoke tests on built skills
yarn validate       # manifest, secrets, and quality checks
yarn validate:secrets
yarn lint
```

Development:

```bash
yarn build:watch    # incremental rebuilds
yarn repl           # interactive harness (see dev/test-harness)
```

---

## Skills in this tree

| Skill                                  | Description                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`server-ping`](src/core/server-ping/) | Reference/demo skill (health ping, DB, state, cron, tools). Marked dev-oriented in manifest. |
| [`notion`](src/core/notion/)           | Notion workspace integration (pages, databases, blocks, search, sync).                       |
| [`gmail`](src/core/gmail/)             | Gmail integration (OAuth, mail tools).                                                       |

The desktop app’s default catalog can point at this GitHub repo; override with `VITE_SKILLS_GITHUB_REPO` when developing locally (see OpenHuman app docs).

---

## Contributing

We welcome new skills, fixes to existing ones, tests, and tooling improvements.

1. **Read [`CONTRIBUTING.md`](CONTRIBUTING.md)** — branching (`feat/`, `fix/`, …), naming (`lowercase-hyphens` skill ids), code expectations (sync code, JSON tool results, no secrets), and PR expectations.
2. **Use the docs** — [`docs/SKILL_SPEC.md`](docs/SKILL_SPEC.md) for scaffolding checklists; [`docs/SKILLS.md`](docs/SKILLS.md) for bridge APIs and workflows.
3. **Place new skills under `src/core/<skill-id>/`** and ensure `yarn typecheck`, `yarn build`, `yarn validate`, and `yarn test` pass before opening a PR.
4. **Issues and PRs** — Use [tinyhumansai/openhuman-skills](https://github.com/tinyhumansai/openhuman-skills) on GitHub; follow the PR template in [`.github/`](.github/).

If you need the full desktop stack locally, clone the main OpenHuman repo and use the `openhuman` submodule here, or clone both apps side by side and point the app at your skills build.
