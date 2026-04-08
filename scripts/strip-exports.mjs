// Post-compilation step: strips `export {};` from compiled JS files,
// converts 4-space indentation to 2-space to match project style,
// and copies manifest.json files from source to output directories.
//
// Needed because skill .ts files use `export {}` to create module scope
// (isolating each skill's top-level declarations), but the V8 runtime
// evaluates scripts via eval() which doesn't support ES module syntax.
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let count = 0;

// Process built skills from src/core/ -> skills/
const srcDir = join(root, 'src', 'core');
const skillsOutputDir = join(root, 'skills');

if (existsSync(srcDir) && existsSync(skillsOutputDir)) {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const skillName = entry.name;
    const srcSkillDir = join(srcDir, skillName);
    const outputSkillDir = join(skillsOutputDir, skillName);

    // Skip if output directory doesn't exist (skill was excluded from compilation)
    if (!existsSync(outputSkillDir)) {
      continue;
    }

    // Process index.js
    const jsFile = join(outputSkillDir, 'index.js');
    if (existsSync(jsFile)) {
      let content = readFileSync(jsFile, 'utf8');

      // Strip `export {};` lines (module boundary marker)
      content = content.replace(/^export\s*\{\s*\}\s*;?\s*$/gm, '');

      // Convert 4-space indentation to 2-space
      content = content.replace(/^( +)/gm, match => ' '.repeat(Math.floor(match.length / 2)));

      // Clean up trailing blank lines
      content = content.trimEnd() + '\n';

      writeFileSync(jsFile, content);
    }

    // Copy manifest.json from source to output (only if output dir exists)
    const srcManifest = join(srcSkillDir, 'manifest.json');
    const outputManifest = join(outputSkillDir, 'manifest.json');
    if (existsSync(srcManifest) && existsSync(outputSkillDir)) {
      copyFileSync(srcManifest, outputManifest);
    }

    count++;
  }
}

// Process examples (they stay in examples/)
const examplesDir = join(root, 'examples');
if (existsSync(examplesDir)) {
  for (const entry of readdirSync(examplesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const jsFile = join(examplesDir, entry.name, 'index.js');
    if (!existsSync(jsFile)) continue;

    let content = readFileSync(jsFile, 'utf8');

    // Strip `export {};` lines (module boundary marker)
    content = content.replace(/^export\s*\{\s*\}\s*;?\s*$/gm, '');

    // Convert 4-space indentation to 2-space
    content = content.replace(/^( +)/gm, match => ' '.repeat(Math.floor(match.length / 2)));

    // Clean up trailing blank lines
    content = content.trimEnd() + '\n';

    writeFileSync(jsFile, content);
    count++;
  }
}

console.log(`Processed ${count} skill(s)`);
