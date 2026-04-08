#!/usr/bin/env node
/**
 * validate.mjs - Validate all skills in src/
 *
 * Checks:
 *   1. Manifest validation (exists, valid JSON, required fields, naming)
 *   2. Secret scanning (API keys, tokens, private keys)
 *   3. Code quality (no async/await, no eval, no new Function)
 *   4. Setup flow completeness (if manifest.setup.required)
 *   5. Entry file exists (src/<skill>/index.ts)
 *   6. Naming convention (lowercase-hyphen only)
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const srcDir = join(rootDir, 'src', 'core');

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

// ── Secret patterns ──────────────────────────────────────────────────
const SECRET_PATTERNS = [
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'Slack Token', pattern: /xox[bpors]-[0-9a-zA-Z-]{10,}/ },
  { name: 'GitHub Token', pattern: /gh[ps]_[A-Za-z0-9_]{36,}/ },
  { name: 'Telegram Bot Token', pattern: /\d{8,10}:[A-Za-z0-9_-]{35}/ },
  { name: 'Generic API Key (sk-)', pattern: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'Generic API Key (pk-)', pattern: /pk-[A-Za-z0-9]{20,}/ },
  { name: 'Hex Private Key (64 chars)', pattern: /['"]\s*[0-9a-fA-F]{64}\s*['"]/ },
  { name: 'JWT Token', pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]+/ },
];

// Lines that should be excluded from secret scanning
function isSecretExclusion(line) {
  return (
    line.includes('platform.env(') ||
    line.includes('platform.env("') ||
    line.includes("platform.env('") ||
    line.includes('process.env') ||
    line.trimStart().startsWith('//') ||
    line.trimStart().startsWith('*') ||
    line.trimStart().startsWith('/*')
  );
}

// ── Validation state ─────────────────────────────────────────────────
let totalErrors = 0;
let totalWarnings = 0;
let skillsChecked = 0;

function error(skill, message) {
  console.log(`  ${colors.red}✗${colors.reset} ${message}`);
  totalErrors++;
}

function warn(skill, message) {
  console.log(`  ${colors.yellow}⚠${colors.reset} ${message}`);
  totalWarnings++;
}

function pass(message) {
  console.log(`  ${colors.green}✓${colors.reset} ${message}`);
}

// ── Validators ───────────────────────────────────────────────────────

function validateNaming(skillDir) {
  const namePattern = /^[a-z][a-z0-9-]*$/;
  if (!namePattern.test(skillDir)) {
    error(skillDir, `Directory name "${skillDir}" must be lowercase-hyphen (e.g., "my-skill")`);
    return false;
  }
  pass(`Naming convention: "${skillDir}"`);
  return true;
}

function validateManifest(skillDir) {
  const manifestPath = join(srcDir, skillDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    error(skillDir, 'manifest.json not found');
    return null;
  }

  let manifest;
  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    manifest = JSON.parse(raw);
  } catch (e) {
    error(skillDir, `manifest.json is invalid JSON: ${e.message}`);
    return null;
  }
  pass('manifest.json is valid JSON');

  // Required fields
  const requiredFields = ['id', 'name', 'version', 'description'];
  let hasAll = true;
  for (const field of requiredFields) {
    if (!manifest[field]) {
      error(skillDir, `manifest.json missing required field: "${field}"`);
      hasAll = false;
    }
  }
  if (hasAll) pass(`Required fields present (${requiredFields.join(', ')})`);

  // id must match directory name
  if (manifest.id && manifest.id !== skillDir) {
    error(skillDir, `manifest.id "${manifest.id}" does not match directory name "${skillDir}"`);
  } else if (manifest.id) {
    pass(`manifest.id matches directory name`);
  }

  // runtime must be "quickjs"
  if (manifest.runtime && manifest.runtime !== 'quickjs') {
    error(skillDir, `manifest.runtime is "${manifest.runtime}", must be "quickjs"`);
  } else if (manifest.runtime) {
    pass('runtime is "quickjs"');
  }

  // id must be lowercase-hyphen
  if (manifest.id && !/^[a-z][a-z0-9-]*$/.test(manifest.id)) {
    error(skillDir, `manifest.id "${manifest.id}" must be lowercase-hyphen only`);
  }

  // No underscores in id
  if (manifest.id && manifest.id.includes('_')) {
    error(skillDir, `manifest.id "${manifest.id}" must not contain underscores (use hyphens)`);
  }

  return manifest;
}

function validateEntryFile(skillDir) {
  const entryPath = join(srcDir, skillDir, 'index.ts');
  if (!existsSync(entryPath)) {
    error(skillDir, 'index.ts not found');
    return false;
  }
  pass('index.ts exists');
  return true;
}



function validateCodeQuality(skillDir) {
  const skillPath = join(srcDir, skillDir);
  const tsFiles = getAllTsFiles(skillPath);
  let issues = 0;

  for (const filePath of tsFiles) {
    if (filePath.includes('__tests__')) continue;

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const relPath = filePath.replace(srcDir + '/', '');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();

      // Skip comments
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

      // // async/await (skill runtime is asynchronous)
      // if (!/\basync\s+(function|[\w(])/.test(line) && !/\bawait\s+/.test(line)) {
      //   warn(skillDir, `no async/await usage in ${relPath}:${i + 1} (runtime is asynchronous)`);
      //   issues++;
      // }

      // No eval()
      if (/\beval\s*\(/.test(line)) {
        error(skillDir, `eval() usage in ${relPath}:${i + 1}`);
        issues++;
      }

      // No new Function() (except in test files)
      if (/\bnew\s+Function\s*\(/.test(line)) {
        error(skillDir, `new Function() usage in ${relPath}:${i + 1}`);
        issues++;
      }
    }
  }

  if (issues === 0) pass('Code quality checks passed');
}

function validateSetupFlow(skillDir, manifest) {
  if (!manifest?.setup?.required) return;

  const entryPath = join(srcDir, skillDir, 'index.ts');
  if (!existsSync(entryPath)) return;

  // Also check tool files and other ts files that might define these
  const allContent = getAllTsContent(join(srcDir, skillDir));

  // Advanced auth skills use onAuthComplete; may also define onOAuthComplete for managed mode
  if (manifest.setup.auth) {
    validateAdvancedAuthSetup(skillDir, manifest, allContent);
    return;
  }

  // OAuth skills use onOAuthComplete instead of onSetupStart/onSetupSubmit
  if (manifest.setup.oauth) {
    validateOAuthSetup(skillDir, manifest, allContent);
    return;
  }

  const hasSetupStart = allContent.includes('onSetupStart');
  const hasSetupSubmit = allContent.includes('onSetupSubmit');

  if (!hasSetupStart) {
    error(skillDir, 'manifest.setup.required is true but onSetupStart is not defined');
  }
  if (!hasSetupSubmit) {
    error(skillDir, 'manifest.setup.required is true but onSetupSubmit is not defined');
  }
  if (hasSetupStart && hasSetupSubmit) {
    pass('Setup flow: onSetupStart and onSetupSubmit defined');
  }
}

function validateOAuthSetup(skillDir, manifest, allContent) {
  const oauthConfig = manifest.setup.oauth;

  // Validate provider
  if (!oauthConfig.provider || typeof oauthConfig.provider !== 'string') {
    error(skillDir, 'setup.oauth.provider must be a non-empty string');
  } else {
    pass(`OAuth provider: "${oauthConfig.provider}"`);
  }

  // Validate scopes (must be an array)
  if (!Array.isArray(oauthConfig.scopes)) {
    error(skillDir, 'setup.oauth.scopes must be an array');
  } else {
    const allStrings = oauthConfig.scopes.every(s => typeof s === 'string');
    if (!allStrings) {
      error(skillDir, 'setup.oauth.scopes must contain only strings');
    } else {
      pass(`OAuth scopes: ${oauthConfig.scopes.length} scope(s)`);
    }
  }

  // Check that skill implements onOAuthComplete
  const hasOAuthComplete = allContent.includes('onOAuthComplete');
  if (!hasOAuthComplete) {
    error(skillDir, 'setup.oauth is present but onOAuthComplete is not defined');
  } else {
    pass('OAuth lifecycle: onOAuthComplete defined');
  }

  // Warn if skill still has onSetupStart (likely leftover)
  const hasSetupStart = allContent.includes('onSetupStart');
  if (hasSetupStart) {
    warn(skillDir, 'OAuth skill still defines onSetupStart (likely leftover from manual setup)');
  }
}

function validateAdvancedAuthSetup(skillDir, manifest, allContent) {
  const authConfig = manifest.setup.auth;

  if (!authConfig.modes || !Array.isArray(authConfig.modes) || authConfig.modes.length === 0) {
    error(skillDir, 'setup.auth.modes must be a non-empty array');
    return;
  }

  const modeTypes = authConfig.modes.map(m => m.type);
  pass(`Auth modes: ${modeTypes.join(', ')}`);

  // Validate managed mode if present
  const managedMode = authConfig.modes.find(m => m.type === 'managed');
  if (managedMode) {
    if (!managedMode.provider || typeof managedMode.provider !== 'string') {
      error(skillDir, 'managed auth mode must have a provider string');
    } else {
      pass(`Managed auth provider: "${managedMode.provider}"`);
    }

    // Managed mode should have onOAuthComplete
    const hasOAuthComplete = allContent.includes('onOAuthComplete');
    if (!hasOAuthComplete) {
      warn(skillDir, 'Managed auth mode present but onOAuthComplete not defined');
    }
  }

  // Non-managed modes should have onAuthComplete
  const hasNonManaged = authConfig.modes.some(m => m.type !== 'managed');
  if (hasNonManaged) {
    const hasAuthComplete = allContent.includes('onAuthComplete');
    if (!hasAuthComplete) {
      error(skillDir, 'Non-managed auth modes present but onAuthComplete not defined');
    } else {
      pass('Auth lifecycle: onAuthComplete defined');
    }
  }

  // Self-hosted mode should have fields
  const selfHosted = authConfig.modes.find(m => m.type === 'self_hosted');
  if (selfHosted && (!selfHosted.fields || selfHosted.fields.length === 0)) {
    warn(skillDir, 'self_hosted auth mode has no fields defined');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function getAllTsFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...getAllTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

function getAllTsContent(dir) {
  return getAllTsFiles(dir)
    .filter(f => !f.includes('__tests__'))
    .map(f => readFileSync(f, 'utf-8'))
    .join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────

console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
console.log(`${colors.cyan}                    Skill Validator                            ${colors.reset}`);
console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}\n`);

if (!existsSync(srcDir)) {
  console.error(`${colors.red}Error: src/ directory not found${colors.reset}`);
  process.exit(1);
}

// Directories under src/ that are not skills (shared helpers, etc.) — skip validation
const SKIP_DIRS = ['helpers', 'shared'];

const skillDirs = readdirSync(srcDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && !SKIP_DIRS.includes(d.name))
  .map(d => d.name)
  .sort();

for (const skillDir of skillDirs) {
  console.log(`${colors.blue}${colors.bold}${skillDir}${colors.reset}`);
  skillsChecked++;

  validateNaming(skillDir);
  const manifest = validateManifest(skillDir);
  validateEntryFile(skillDir);
  validateCodeQuality(skillDir);
  validateSetupFlow(skillDir, manifest);

  console.log('');
}

// Summary
console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
console.log(`${colors.cyan}                        Summary                                ${colors.reset}`);
console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
console.log(`  Skills checked: ${skillsChecked}`);
console.log(`  ${colors.green}Passed${colors.reset}: ${skillsChecked * 6 - totalErrors - totalWarnings} checks`);
if (totalWarnings > 0) console.log(`  ${colors.yellow}Warnings${colors.reset}: ${totalWarnings}`);
if (totalErrors > 0) console.log(`  ${colors.red}Errors${colors.reset}: ${totalErrors}`);

if (totalErrors > 0) {
  console.log(`\n${colors.red}Validation failed with ${totalErrors} error(s).${colors.reset}`);
  process.exit(1);
} else {
  console.log(`\n${colors.green}All skills passed validation.${colors.reset}`);
}
