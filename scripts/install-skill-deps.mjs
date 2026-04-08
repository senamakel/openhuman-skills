#!/usr/bin/env node
// install-skill-deps.mjs - Install per-skill npm dependencies
// Iterates skill directories and runs yarn install in each one
// that has its own dependencies. esbuild resolves node_modules
// relative to entry points, so bundling works automatically.
import { existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const srcDir = join(rootDir, 'src', 'core');

const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

const skillDirs = readdirSync(srcDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

let installed = 0;

for (const skill of skillDirs) {
  const pkgPath = join(srcDir, skill, 'package.json');
  if (!existsSync(pkgPath)) continue;

  console.log(`${colors.blue}Installing deps for ${skill}...${colors.reset}`);
  try {
    execSync('yarn install --no-lockfile', {
      cwd: join(srcDir, skill),
      stdio: 'pipe',
    });
    console.log(`  ${colors.green}✓${colors.reset} ${skill} dependencies installed`);
    installed++;
  } catch (e) {
    console.error(`  ${colors.yellow}⚠${colors.reset} ${skill}: ${e.message}`);
  }
}

if (installed === 0)
  console.log(`${colors.dim}No skill-level package.json files found.${colors.reset}`);
else
  console.log(`\n${colors.green}Installed dependencies for ${installed} skill(s).${colors.reset}`);
