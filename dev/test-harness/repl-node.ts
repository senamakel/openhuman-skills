#!/usr/bin/env tsx
/**
 * repl-node.ts — Interactive REPL for skill development.
 *
 * Connects to the real Rust QuickJS skills runtime via JSON-RPC.
 * Optionally starts the runtime automatically if not already running.
 *
 * Usage:
 *   yarn repl [skill-id] [--clean] [--port 7799]
 */

import { spawn, type ChildProcess } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline/promises';
import { createGhostInput, type SuggestionSource } from './ghost-input';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '../..');

const c = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CORE_BINARY = resolve(rootDir, 'openhuman', 'target', 'debug', 'openhuman-core');
const SKILLS_DIR = resolve(rootDir, 'skills');

let RUNTIME_PORT = 7799;
let RUNTIME_URL = `http://127.0.0.1:${RUNTIME_PORT}`;
let runtimeProcess: ChildProcess | null = null;
let activeSkillId: string | null = null;

// ---------------------------------------------------------------------------
// JSON-RPC client
// ---------------------------------------------------------------------------

let rpcId = 0;

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const id = ++rpcId;
  const response = await fetch(`${RUNTIME_URL}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const json = (await response.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function httpGet(path: string): Promise<unknown> {
  const response = await fetch(`${RUNTIME_URL}${path}`);
  return response.json();
}

// ---------------------------------------------------------------------------
// Runtime lifecycle
// ---------------------------------------------------------------------------

async function isRuntimeRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${RUNTIME_URL}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function startRuntime(): Promise<void> {
  if (await isRuntimeRunning()) {
    console.log(`${c.dim}Runtime already running on port ${RUNTIME_PORT}${c.reset}`);
    return;
  }

  if (!existsSync(CORE_BINARY)) {
    console.log(`${c.red}openhuman-core binary not found. Run: yarn core:build${c.reset}`);
    process.exit(1);
  }

  console.log(`${c.blue}Starting skills runtime on port ${RUNTIME_PORT}...${c.reset}`);

  runtimeProcess = spawn(CORE_BINARY, [
    'skills', 'run',
    '--skills-dir', SKILLS_DIR,
    '--port', String(RUNTIME_PORT),
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, RUST_LOG: process.env.RUST_LOG || 'warn' },
  });

  runtimeProcess.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.log(`${c.dim}[runtime] ${text}${c.reset}`);
  });

  runtimeProcess.on('exit', (code) => {
    if (code && code !== 0) {
      console.log(`${c.red}Runtime exited with code ${code}${c.reset}`);
    }
    runtimeProcess = null;
  });

  // Wait for health
  const start = Date.now();
  while (Date.now() - start < 30000) {
    if (await isRuntimeRunning()) {
      console.log(`${c.green}Runtime ready.${c.reset}`);
      return;
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`${c.red}Runtime failed to start within 30s${c.reset}`);
  runtimeProcess?.kill();
  process.exit(1);
}

function stopRuntime(): void {
  if (runtimeProcess) {
    runtimeProcess.kill('SIGTERM');
    runtimeProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Skill helpers
// ---------------------------------------------------------------------------

function discoverLocalSkills(): Array<{ id: string; name: string }> {
  if (!existsSync(SKILLS_DIR)) return [];
  const result: Array<{ id: string; name: string }> = [];
  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const mp = resolve(SKILLS_DIR, entry.name, 'manifest.json');
    if (existsSync(mp)) {
      try {
        const m = JSON.parse(readFileSync(mp, 'utf-8'));
        result.push({ id: entry.name, name: m.name || entry.name });
      } catch {}
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

async function startSkill(id: string): Promise<any> {
  return rpc('openhuman.skills_start', { skill_id: id });
}

async function stopSkill(id: string): Promise<void> {
  await rpc('openhuman.skills_stop', { skill_id: id });
}

async function getStatus(id: string): Promise<any> {
  return rpc('openhuman.skills_status', { skill_id: id });
}

async function callTool(id: string, toolName: string, args: Record<string, unknown> = {}): Promise<any> {
  return rpc('openhuman.skills_call_tool', {
    skill_id: id,
    tool_name: toolName,
    arguments: args,
  });
}

async function skillRpc(id: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
  return rpc('openhuman.skills_rpc', { skill_id: id, method, params });
}

// ---------------------------------------------------------------------------
// Pretty printing
// ---------------------------------------------------------------------------

function prettyJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  return json
    .replace(/"([^"]+)":/g, `${c.cyan}"$1"${c.reset}:`)
    .replace(/: "(.*?)"/g, `: ${c.green}"$1"${c.reset}`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const COMMANDS: Record<string, {
  description: string;
  usage?: string;
  run: (args: string, rl: readline.Interface) => Promise<void>;
}> = {
  help: {
    description: 'Show available commands',
    async run() {
      console.log(`\n${c.bold}Commands:${c.reset}\n`);
      for (const [name, cmd] of Object.entries(COMMANDS)) {
        const usage = cmd.usage ? ` ${c.dim}${cmd.usage}${c.reset}` : '';
        console.log(`  ${c.cyan}${name}${c.reset}${usage}`);
        console.log(`    ${c.dim}${cmd.description}${c.reset}`);
      }
      console.log();
    },
  },

  skills: {
    description: 'List available skills',
    async run() {
      const data = await httpGet('/skills') as { skills: any[] };
      const running = data.skills || [];
      const local = discoverLocalSkills();

      console.log(`\n${c.bold}Skills:${c.reset}`);
      for (const s of local) {
        const rs = running.find((r: any) => r.skill_id === s.id);
        const status = rs
          ? `${c.green}${rs.status}${c.reset}`
          : `${c.dim}stopped${c.reset}`;
        const marker = s.id === activeSkillId ? ` ${c.yellow}(active)${c.reset}` : '';
        console.log(`  ${c.cyan}${s.id}${c.reset} — ${s.name} [${status}]${marker}`);
      }
      console.log();
    },
  },

  use: {
    description: 'Set the active skill for tool calls',
    usage: '<skill-id>',
    async run(args) {
      const id = args.trim();
      if (!id) {
        console.log(`${c.yellow}Usage: use <skill-id>${c.reset}`);
        return;
      }
      activeSkillId = id;
      console.log(`${c.green}Active skill: ${id}${c.reset}`);
    },
  },

  start: {
    description: 'Start a skill (or the active skill)',
    usage: '[skill-id]',
    async run(args) {
      const id = args.trim() || activeSkillId;
      if (!id) { console.log(`${c.yellow}No active skill. Use: start <skill-id>${c.reset}`); return; }
      try {
        const snap = await startSkill(id);
        activeSkillId = id;
        console.log(`${c.green}Started ${id} — ${snap.status}${c.reset} (${snap.tools?.length || 0} tools)`);
      } catch (e: any) {
        console.log(`${c.red}Failed: ${e.message}${c.reset}`);
      }
    },
  },

  stop: {
    description: 'Stop a skill (or the active skill)',
    usage: '[skill-id]',
    async run(args) {
      const id = args.trim() || activeSkillId;
      if (!id) { console.log(`${c.yellow}No active skill.${c.reset}`); return; }
      try {
        await stopSkill(id);
        console.log(`${c.green}Stopped ${id}${c.reset}`);
      } catch (e: any) {
        console.log(`${c.red}Failed: ${e.message}${c.reset}`);
      }
    },
  },

  tools: {
    description: 'List tools for the active skill',
    usage: '[skill-id]',
    async run(args) {
      const id = args.trim() || activeSkillId;
      if (!id) { console.log(`${c.yellow}No active skill.${c.reset}`); return; }
      try {
        const snap = await getStatus(id);
        if (!snap.tools || snap.tools.length === 0) {
          console.log(`${c.dim}No tools registered.${c.reset}`);
          return;
        }
        console.log(`\n${c.bold}Tools (${snap.tools.length}):${c.reset}`);
        for (const t of snap.tools) {
          console.log(`  ${c.cyan}${t.name}${c.reset} — ${c.dim}${t.description}${c.reset}`);
          if (t.inputSchema?.properties) {
            const props = t.inputSchema.properties;
            const required = new Set(t.inputSchema.required || []);
            for (const [name, schema] of Object.entries(props) as [string, any][]) {
              const req = required.has(name) ? `${c.red}*${c.reset}` : '';
              console.log(`    ${c.dim}--${name}${req} (${schema.type || '?'})${c.reset}`);
            }
          }
        }
        console.log();
      } catch (e: any) {
        console.log(`${c.red}Failed: ${e.message}${c.reset}`);
      }
    },
  },

  call: {
    description: 'Call a tool on the active skill',
    usage: '<tool-name> [--arg value ...]',
    async run(args) {
      if (!activeSkillId) { console.log(`${c.yellow}No active skill. Use: use <skill-id>${c.reset}`); return; }
      const parts = args.trim().split(/\s+/);
      const toolName = parts[0];
      if (!toolName) { console.log(`${c.yellow}Usage: call <tool-name> [--arg value ...]${c.reset}`); return; }

      // Parse --arg value pairs
      const toolArgs: Record<string, unknown> = {};
      let i = 1;
      while (i < parts.length) {
        if (parts[i].startsWith('--')) {
          const key = parts[i].slice(2);
          const val = parts[i + 1] || '';
          // Try to parse as JSON, fall back to string
          try { toolArgs[key] = JSON.parse(val); } catch { toolArgs[key] = val; }
          i += 2;
        } else {
          i++;
        }
      }

      try {
        const result = await callTool(activeSkillId, toolName, toolArgs);
        console.log(prettyJson(result));
      } catch (e: any) {
        console.log(`${c.red}${e.message}${c.reset}`);
      }
    },
  },

  status: {
    description: 'Show skill status and state',
    usage: '[skill-id]',
    async run(args) {
      const id = args.trim() || activeSkillId;
      if (!id) { console.log(`${c.yellow}No active skill.${c.reset}`); return; }
      try {
        const snap = await getStatus(id);
        console.log(prettyJson(snap));
      } catch (e: any) {
        console.log(`${c.red}Failed: ${e.message}${c.reset}`);
      }
    },
  },

  setup: {
    description: 'Run the setup wizard for the active skill',
    usage: '[skill-id]',
    async run(args, rl) {
      const id = args.trim() || activeSkillId;
      if (!id) { console.log(`${c.yellow}No active skill.${c.reset}`); return; }

      try {
        let result = await skillRpc(id, 'setup/start') as any;
        let step = result.step;

        while (step) {
          console.log(`\n${c.bold}${step.title}${c.reset}`);
          if (step.description) console.log(`${c.dim}${step.description}${c.reset}\n`);

          const values: Record<string, unknown> = {};
          for (const field of step.fields || []) {
            const label = `${c.cyan}${field.label}${field.required ? ` ${c.red}*` : ''}${c.reset}`;
            const defaultVal = field.default != null ? ` ${c.dim}(${field.default})${c.reset}` : '';

            if (field.type === 'select' && field.options) {
              console.log(`  ${label}${defaultVal}`);
              for (let i = 0; i < field.options.length; i++) {
                console.log(`    ${c.dim}${i + 1})${c.reset} ${field.options[i].label} ${c.dim}(${field.options[i].value})${c.reset}`);
              }
              const raw = await rl.question(`  Choice: `);
              const idx = parseInt(raw) - 1;
              values[field.name] = idx >= 0 && idx < field.options.length
                ? field.options[idx].value
                : raw.trim() || field.default;
            } else if (field.type === 'boolean') {
              const raw = await rl.question(`  ${label}${defaultVal} (y/n): `);
              values[field.name] = raw.toLowerCase().startsWith('y') || raw === 'true';
            } else {
              const raw = await rl.question(`  ${label}${defaultVal}: `);
              values[field.name] = raw.trim() || field.default;
            }
          }

          const submitResult = await skillRpc(id, 'setup/submit', {
            stepId: step.id,
            values,
          }) as any;

          if (submitResult.status === 'error') {
            console.log(`\n${c.red}Errors:${c.reset}`);
            for (const err of submitResult.errors || []) {
              console.log(`  ${c.red}${err.field}: ${err.message}${c.reset}`);
            }
            continue; // re-run same step
          }
          if (submitResult.status === 'complete') {
            console.log(`\n${c.green}Setup complete!${c.reset}`);
            return;
          }
          if (submitResult.status === 'next' && submitResult.nextStep) {
            step = submitResult.nextStep;
            continue;
          }
          console.log(`${c.yellow}Unknown status: ${submitResult.status}${c.reset}`);
          return;
        }
      } catch (e: any) {
        console.log(`${c.red}Setup failed: ${e.message}${c.reset}`);
      }
    },
  },

  data: {
    description: 'Read a file from the skill data directory',
    usage: '<filename>',
    async run(args) {
      const id = activeSkillId;
      if (!id) { console.log(`${c.yellow}No active skill.${c.reset}`); return; }
      const filename = args.trim();
      if (!filename) { console.log(`${c.yellow}Usage: data <filename>${c.reset}`); return; }
      try {
        const result = await rpc('openhuman.skills_data_read', {
          skill_id: id,
          filename,
        }) as { content: string | null };
        if (result.content === null) {
          console.log(`${c.dim}(file not found)${c.reset}`);
        } else {
          console.log(result.content);
        }
      } catch (e: any) {
        console.log(`${c.red}${e.message}${c.reset}`);
      }
    },
  },

  rpc: {
    description: 'Send a raw RPC to a skill',
    usage: '<method> [json-params]',
    async run(args) {
      const id = activeSkillId;
      if (!id) { console.log(`${c.yellow}No active skill.${c.reset}`); return; }
      const [method, ...rest] = args.trim().split(/\s+/);
      if (!method) { console.log(`${c.yellow}Usage: rpc <method> [json-params]${c.reset}`); return; }
      let params = {};
      if (rest.length > 0) {
        try { params = JSON.parse(rest.join(' ')); } catch {
          console.log(`${c.red}Invalid JSON params${c.reset}`); return;
        }
      }
      try {
        const result = await skillRpc(id, method, params);
        console.log(prettyJson(result));
      } catch (e: any) {
        console.log(`${c.red}${e.message}${c.reset}`);
      }
    },
  },

  discover: {
    description: 'Discover available skills on the runtime',
    async run() {
      try {
        const manifests = await rpc('openhuman.skills_discover') as any[];
        console.log(`\n${c.bold}Discovered ${manifests.length} skill(s):${c.reset}`);
        for (const m of manifests) {
          console.log(`  ${c.cyan}${m.id}${c.reset} — ${m.name} (v${m.version || '?'})`);
        }
        console.log();
      } catch (e: any) {
        console.log(`${c.red}${e.message}${c.reset}`);
      }
    },
  },

  reload: {
    description: 'Stop and restart the active skill',
    async run() {
      if (!activeSkillId) { console.log(`${c.yellow}No active skill.${c.reset}`); return; }
      try {
        await stopSkill(activeSkillId);
        const snap = await startSkill(activeSkillId);
        console.log(`${c.green}Reloaded ${activeSkillId} — ${snap.status}${c.reset}`);
      } catch (e: any) {
        console.log(`${c.red}${e.message}${c.reset}`);
      }
    },
  },

  build: {
    description: 'Rebuild skills (yarn build) then reload',
    async run() {
      console.log(`${c.blue}Building skills...${c.reset}`);
      const { execSync } = await import('child_process');
      try {
        execSync('yarn build', { cwd: rootDir, stdio: 'inherit' });
        console.log(`${c.green}Build complete.${c.reset}`);
        if (activeSkillId) {
          try {
            await stopSkill(activeSkillId);
            const snap = await startSkill(activeSkillId);
            console.log(`${c.green}Reloaded ${activeSkillId} — ${snap.status}${c.reset}`);
          } catch (e: any) {
            console.log(`${c.yellow}Reload failed: ${e.message}${c.reset}`);
          }
        }
      } catch {
        console.log(`${c.red}Build failed.${c.reset}`);
      }
    },
  },

  exit: {
    description: 'Exit the REPL',
    async run() {
      if (activeSkillId) {
        try { await stopSkill(activeSkillId); } catch {}
      }
      stopRuntime();
      process.exit(0);
    },
  },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Parse args
  let initialSkillId: string | null = null;
  let cleanFlag = false;

  for (const arg of process.argv.slice(2)) {
    if (arg === '--clean') { cleanFlag = true; continue; }
    if (arg === '--port') { continue; }
    if (process.argv[process.argv.indexOf(arg) - 1] === '--port') {
      RUNTIME_PORT = parseInt(arg);
      RUNTIME_URL = `http://127.0.0.1:${RUNTIME_PORT}`;
      continue;
    }
    if (!arg.startsWith('-')) {
      initialSkillId = arg;
    }
  }

  // Banner
  console.log(`${c.cyan}═══════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.cyan}         OpenHuman Skills REPL (Rust Runtime)              ${c.reset}`);
  console.log(`${c.cyan}═══════════════════════════════════════════════════════════${c.reset}`);
  console.log(`${c.dim}Type "help" for commands, "exit" to quit.${c.reset}\n`);

  // Start the runtime
  await startRuntime();

  // If a skill was specified, start it
  if (initialSkillId) {
    try {
      const snap = await startSkill(initialSkillId);
      activeSkillId = initialSkillId;
      console.log(`${c.green}Started ${initialSkillId} — ${snap.status}${c.reset} (${snap.tools?.length || 0} tools)`);
    } catch (e: any) {
      console.log(`${c.red}Failed to start ${initialSkillId}: ${e.message}${c.reset}`);
    }
  }

  // Build suggestion sources for ghost-input
  const commandNames = Object.keys(COMMANDS);

  const commandSuggestions: SuggestionSource = {
    suggest(line: string): string | null {
      if (!line) return null;
      for (const name of commandNames) {
        if (name.startsWith(line) && name !== line) {
          return name.slice(line.length);
        }
      }
      return null;
    },
  };

  const toolSuggestions: SuggestionSource = {
    suggest(line: string): string | null {
      if (!line.startsWith('call ')) return null;
      const partial = line.slice(5);
      if (!activeSkillId || partial.includes(' ')) return null;
      // We can't synchronously fetch tools, so return null
      // (could be enhanced with a cached tool list)
      return null;
    },
  };

  const skillSuggestions: SuggestionSource = {
    suggest(line: string): string | null {
      const prefixes = ['use ', 'start ', 'stop ', 'tools ', 'status '];
      for (const prefix of prefixes) {
        if (line.startsWith(prefix)) {
          const partial = line.slice(prefix.length);
          const locals = discoverLocalSkills();
          for (const s of locals) {
            if (s.id.startsWith(partial) && s.id !== partial) {
              return s.id.slice(partial.length);
            }
          }
        }
      }
      return null;
    },
  };

  // Create input handler
  function makePrompt(): string {
    const prefix = activeSkillId ? `${c.cyan}${activeSkillId}${c.reset}` : `${c.dim}no-skill${c.reset}`;
    return `${prefix} ${c.dim}>${c.reset} `;
  }

  const ghost = createGhostInput(process.stdin, process.stdout, {
    prompt: makePrompt(),
    sources: [commandSuggestions, skillSuggestions, toolSuggestions],
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // REPL loop
  while (true) {
    let line: string;
    try {
      line = await ghost.question();
    } catch {
      // EOF or Ctrl+C
      break;
    }

    line = line.trim();
    if (!line) continue;

    // Parse command
    const spaceIdx = line.indexOf(' ');
    const cmdName = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
    const cmdArgs = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1);

    const cmd = COMMANDS[cmdName];
    if (cmd) {
      try {
        await cmd.run(cmdArgs, rl);
      } catch (e: any) {
        console.log(`${c.red}Error: ${e.message}${c.reset}`);
      }
    } else {
      // If it looks like a tool name and there's an active skill, try calling it
      if (activeSkillId && !cmdName.includes(' ')) {
        try {
          // Try as a tool call
          const parts = line.split(/\s+/);
          const toolName = parts[0];
          const toolArgs: Record<string, unknown> = {};
          let i = 1;
          while (i < parts.length) {
            if (parts[i].startsWith('--')) {
              const key = parts[i].slice(2);
              const val = parts[i + 1] || '';
              try { toolArgs[key] = JSON.parse(val); } catch { toolArgs[key] = val; }
              i += 2;
            } else { i++; }
          }
          const result = await callTool(activeSkillId, toolName, toolArgs);
          console.log(prettyJson(result));
        } catch (e: any) {
          console.log(`${c.red}Unknown command: ${cmdName}${c.reset}`);
          console.log(`${c.dim}Type "help" for available commands.${c.reset}`);
        }
      } else {
        console.log(`${c.red}Unknown command: ${cmdName}${c.reset}`);
        console.log(`${c.dim}Type "help" for available commands.${c.reset}`);
      }
    }
  }

  // Cleanup
  if (activeSkillId) {
    try { await stopSkill(activeSkillId); } catch {}
  }
  stopRuntime();
  ghost.destroy();
  rl.close();
}

main().catch((e) => {
  console.error(e);
  stopRuntime();
  process.exit(1);
});
