#!/usr/bin/env node
/**
 * scan-secrets.mjs - Scan skill source for hardcoded secrets
 *
 * Quick CI-friendly secret scanner. Exits with code 1 if any secrets found.
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
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

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

function isExclusion(line) {
  return (
    line.includes('platform.env(') ||
    line.includes('process.env') ||
    line.trimStart().startsWith('//') ||
    line.trimStart().startsWith('*') ||
    line.trimStart().startsWith('/*')
  );
}

function getAllTsFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules')
      results.push(...getAllTsFiles(fullPath));
    else if (entry.name.endsWith('.ts') && !fullPath.includes('__tests__'))
      results.push(fullPath);
  }
  return results;
}

console.log(`${colors.yellow}Scanning for secrets...${colors.reset}\n`);

let found = 0;
const tsFiles = getAllTsFiles(srcDir);

for (const filePath of tsFiles) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relPath = filePath.replace(rootDir + '/', '');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isExclusion(line)) continue;

    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        console.log(`${colors.red}✗${colors.reset} ${name} in ${relPath}:${i + 1}`);
        console.log(`  ${colors.dim}${line.trim().substring(0, 100)}${colors.reset}`);
        found++;
      }
    }
  }
}

if (found > 0) {
  console.log(`\n${colors.red}Found ${found} potential secret(s).${colors.reset}`);
  process.exit(1);
} else {
  console.log(`${colors.green}No secrets found.${colors.reset}`);
}
