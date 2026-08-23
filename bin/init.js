#!/usr/bin/env node

/**
 * AI Dual-Track Testing — CLI Init & Lock Tool
 * 
 * Auto-detects AI tool and injects testing skill.
 * Supports locking requirements with cryptographic SHA-256 checksum upfront.
 * 
 * Usage:
 *   npx ai-dual-testing                    # Setup / Update testing scaffold & rules
 *   npx ai-dual-testing lock "Req 1\nReq2" # Lock requirements upfront before coding
 *   npx ai-dual-testing lock -f reqs.txt   # Lock requirements from a file
 *   npx ai-dual-testing verify             # Run verification suite directly
 * 
 * Zero dependencies — Node.js built-ins only.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

// ─── Config ─────────────────────────────────────────────
const CWD = process.cwd();
const PKG_ROOT = path.resolve(__dirname, '..');
const TEMPLATES = path.join(PKG_ROOT, 'templates');
const AI_TESTING_DIR = path.join(CWD, '.ai-testing');

// ─── Colors (ANSI) ──────────────────────────────────────
const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

// ─── AI Tool Detection ─────────────────────────────────
const AI_TOOLS = [
  {
    name: 'Cursor',
    detect: (dir = CWD) => fs.existsSync(path.join(dir, '.cursorrules')) || fs.existsSync(path.join(dir, '.cursor')),
    ruleFile: '.cursorrules',
    templateRule: 'cursor.md',
    inject: 'append',
  },
  {
    name: 'Antigravity',
    detect: (dir = CWD) => fs.existsSync(path.join(dir, '.agents')) || fs.existsSync(path.join(dir, 'AGENTS.md')),
    ruleFile: '.agents/skills/ai-testing/SKILL.md',
    templateRule: 'antigravity.md',
    inject: 'create',  // Create as skill file
  },
  {
    name: 'Claude Code',
    detect: (dir = CWD) => fs.existsSync(path.join(dir, 'CLAUDE.md')),
    ruleFile: 'CLAUDE.md',
    templateRule: 'claude.md',
    inject: 'append',
  },
  {
    name: 'Windsurf',
    detect: (dir = CWD) => fs.existsSync(path.join(dir, '.windsurfrules')),
    ruleFile: '.windsurfrules',
    templateRule: 'windsurf.md',
    inject: 'append',
  },
];

// ─── Detect AI Tool ─────────────────────────────────────
function detectAITool(targetDir = CWD) {
  for (const tool of AI_TOOLS) {
    if (tool.detect(targetDir)) return tool;
  }
  return null;
}

// ─── Detect Project Type ────────────────────────────────
function detectProject(targetDir = CWD) {
  const pkgPath = path.join(targetDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { framework: 'generic', language: 'javascript' };
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    let framework = 'generic';
    if (allDeps['next']) framework = 'nextjs';
    else if (allDeps['nuxt']) framework = 'nuxt';
    else if (allDeps['vue']) framework = 'vue';
    else if (allDeps['vite'] || allDeps['@vitejs/plugin-react']) framework = 'vite';
    else if (allDeps['express'] || allDeps['fastify'] || allDeps['hono']) framework = 'node-api';

    const language = fs.existsSync(path.join(targetDir, 'tsconfig.json')) ? 'typescript' : 'javascript';
    const hasVitest = !!allDeps['vitest'];
    const hasPlaywright = !!allDeps['@playwright/test'];
    const hasTsx = !!allDeps['tsx'];

    return { framework, language, deps: allDeps, hasVitest, hasPlaywright, hasTsx };
  } catch {
    return { framework: 'generic', language: 'javascript' };
  }
}

// ─── Compute Checksum ───────────────────────────────────
function deterministicStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(deterministicStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + deterministicStringify(obj[k])).join(',') + '}';
}

function computeChecksum(obj) {
  const normalized = deterministicStringify(obj || []);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// ─── Inject Rules ───────────────────────────────────────
function injectRules(tool, targetDir = CWD) {
  const templatePath = path.join(TEMPLATES, 'rules', tool.templateRule);
  if (!fs.existsSync(templatePath)) {
    console.log(c.yellow(`   ⚠️  Template not found: ${tool.templateRule}`));
    return false;
  }

  const rules = fs.readFileSync(templatePath, 'utf-8');
  const targetPath = path.join(targetDir, tool.ruleFile);
  const MARKER = '<!-- AI-DUAL-TESTING-START -->';
  const MARKER_END = '<!-- AI-DUAL-TESTING-END -->';

  if (tool.inject === 'create') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetPath, rules, 'utf-8');
    console.log(c.green(`   ✅ Created ${tool.ruleFile}`));
    return true;
  }

  // Append / replace mode
  if (fs.existsSync(targetPath)) {
    const existing = fs.readFileSync(targetPath, 'utf-8');

    if (existing.includes(MARKER)) {
      const re = new RegExp(`${MARKER}[\\s\\S]*?${MARKER_END}`, 'g');
      const updated = existing.replace(re, `${MARKER}\n${rules}\n${MARKER_END}`);
      fs.writeFileSync(targetPath, updated, 'utf-8');
      console.log(c.green(`   ✅ Updated rules in ${tool.ruleFile}`));
      return true;
    }

    fs.appendFileSync(targetPath, `\n\n${MARKER}\n${rules}\n${MARKER_END}\n`, 'utf-8');
    console.log(c.green(`   ✅ Appended rules to ${tool.ruleFile}`));
  } else {
    fs.writeFileSync(targetPath, `${MARKER}\n${rules}\n${MARKER_END}\n`, 'utf-8');
    console.log(c.green(`   ✅ Created ${tool.ruleFile}`));
  }

  return true;
}

// ─── Scaffold .ai-testing/ ──────────────────────────────
function scaffold(targetBaseDir = CWD) {
  const testingDir = path.join(targetBaseDir, '.ai-testing');
  const dirs = [
    path.join(testingDir, 'scripts'),
    path.join(testingDir, 'configs'),
    path.join(testingDir, 'reports', 'screenshots'),
    path.join(testingDir, 'e2e'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // Copy scripts
  const scriptsDir = path.join(TEMPLATES, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    for (const file of fs.readdirSync(scriptsDir)) {
      const src = path.join(scriptsDir, file);
      const dest = path.join(testingDir, 'scripts', file);
      fs.copyFileSync(src, dest);
      console.log(c.green(`   ✅ Created .ai-testing/scripts/${file}`));
    }
  }

  // Copy configs (preserve locked requirements.json)
  const configsDir = path.join(TEMPLATES, 'configs');
  if (fs.existsSync(configsDir)) {
    for (const file of fs.readdirSync(configsDir)) {
      const src = path.join(configsDir, file);
      const dest = path.join(testingDir, 'configs', file);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        console.log(c.green(`   ✅ Created .ai-testing/configs/${file}`));
      } else if (file === 'requirements.json') {
        try {
          const existing = JSON.parse(fs.readFileSync(dest, 'utf-8'));
          if (existing.locked) {
            console.log(c.green(`   🔒 Preserved .ai-testing/configs/${file} (locked with ${(existing.requirements || []).length} requirements)`));
          } else {
            fs.copyFileSync(src, dest);
            console.log(c.green(`   ✅ Updated .ai-testing/configs/${file} (was unlocked)`));
          }
        } catch {
          fs.copyFileSync(src, dest);
          console.log(c.green(`   ✅ Replaced .ai-testing/configs/${file} (invalid JSON)`));
        }
      } else {
        console.log(c.dim(`   ⏭️  Skipped .ai-testing/configs/${file} (exists)`));
      }
    }
  }

  // Create .gitkeep in reports
  const gitkeep = path.join(testingDir, 'reports', '.gitkeep');
  if (!fs.existsSync(gitkeep)) {
    fs.writeFileSync(gitkeep, '', 'utf-8');
  }
}

// ─── Update .gitignore ──────────────────────────────────
function updateGitignore(targetDir = CWD) {
  const gitignorePath = path.join(targetDir, '.gitignore');
  const entries = [
    '# AI Dual-Track Testing — ignore local artifacts & reports',
    '.ai-testing/reports/',
    '.ai-testing/temp/',
    'test-results/',
    'playwright-report/',
    'coverage/',
  ];

  const block = entries.join('\n');

  if (fs.existsSync(gitignorePath)) {
    let content = fs.readFileSync(gitignorePath, 'utf-8');
    // If old broad .ai-testing/ was present, replace it with specific reports/
    if (content.includes('\n.ai-testing/\n') || content.includes('\n.ai-testing/\r\n') || content.trim() === '.ai-testing/') {
      content = content.replace(/(?:^|\n)\.ai-testing\/(?=\n|\r|$)/g, '\n.ai-testing/reports/\n.ai-testing/temp/');
      fs.writeFileSync(gitignorePath, content, 'utf-8');
      console.log(c.green(`   ✅ Updated .gitignore (refined .ai-testing/ scope)`));
      return;
    }
    if (content.includes('.ai-testing/reports/') || content.includes('.ai-testing/reports')) {
      return;
    }
    fs.appendFileSync(gitignorePath, `\n\n${block}\n`, 'utf-8');
  } else {
    fs.writeFileSync(gitignorePath, `${block}\n`, 'utf-8');
  }

  console.log(c.green(`   ✅ Updated .gitignore`));
}

// ─── Detect Package Manager ─────────────────────────────
function detectPM(targetDir = CWD) {
  if (fs.existsSync(path.join(targetDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(targetDir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

// ─── Install Testing Tools ──────────────────────────────
function installTestingTools(project, targetDir = CWD) {
  const toInstall = [];

  if (!project.hasVitest) toInstall.push('vitest');
  if (!project.hasPlaywright) toInstall.push('@playwright/test');
  if (!project.hasTsx) toInstall.push('tsx');

  if (toInstall.length === 0) {
    console.log(c.green('   ✅ All testing tools already installed'));
    return;
  }

  const pm = detectPM(targetDir);
  const installCmd = pm === 'npm'
    ? `npm install -D ${toInstall.join(' ')}`
    : pm === 'yarn'
      ? `yarn add -D ${toInstall.join(' ')}`
      : `pnpm add -D ${toInstall.join(' ')}`;

  console.log(`   Package manager: ${c.bold(pm)}`);
  console.log(`   Installing: ${c.bold(toInstall.join(', '))}`);
  console.log(c.dim(`   $ ${installCmd}`));
  console.log('');

  try {
    execSync(installCmd, { cwd: targetDir, stdio: 'inherit' });
    console.log('');
    console.log(c.green('   ✅ Testing tools installed'));

    if (toInstall.includes('@playwright/test')) {
      console.log('');
      console.log(c.cyan('   📥 Installing Playwright browsers (chromium)...'));
      try {
        execSync('npx playwright install chromium', { cwd: targetDir, stdio: 'inherit' });
        console.log(c.green('   ✅ Chromium browser installed'));
      } catch {
        console.log(c.yellow('   ⚠️  Could not install browsers. Run manually: npx playwright install'));
      }
    }
  } catch (e) {
    console.log(c.yellow(`   ⚠️  Install failed. Run manually: ${installCmd}`));
  }
}

// ─── Command: Lock Requirements Upfront ─────────────────
function handleLockCommand(args, targetBaseDir = CWD) {
  console.log('');
  console.log(c.bold('🔒 AI Dual-Track Testing — Lock Requirements'));
  console.log(c.dim('   Lock user requirements BEFORE coding with cryptographic SHA-256 checksum'));
  console.log('');

  scaffold(targetBaseDir);

  const configsDir = path.join(targetBaseDir, '.ai-testing', 'configs');
  const reqFilePath = path.join(configsDir, 'requirements.json');

  let rawInput = '';
  const fileFlagIndex = args.indexOf('-f');

  if (fileFlagIndex !== -1 && args[fileFlagIndex + 1]) {
    const srcFile = path.resolve(targetBaseDir, args[fileFlagIndex + 1]);
    if (!fs.existsSync(srcFile)) {
      console.error(c.red(`❌ File not found: ${srcFile}`));
      process.exit(1);
    }
    rawInput = fs.readFileSync(srcFile, 'utf-8');
  } else {
    // Collect all positional arguments after "lock"
    const lockArgs = args.filter(a => a !== 'lock' && a !== '-f');
    rawInput = lockArgs.join(' ').trim();
  }

  if (!rawInput) {
    console.error(c.red('❌ Error: No requirement input provided.'));
    console.log('Usage:');
    console.log('  npx ai-dual-testing lock "User can login with email and password"');
    console.log('  npx ai-dual-testing lock -f PRD.md');
    process.exit(1);
  }

  let requirementsList = [];

  // Check if input is already JSON
  try {
    const parsed = JSON.parse(rawInput);
    if (Array.isArray(parsed)) {
      requirementsList = parsed;
    } else if (parsed.requirements && Array.isArray(parsed.requirements)) {
      requirementsList = parsed.requirements;
    }
  } catch {
    // Parse line by line or numbered list
  }

  // Check if existing locked requirements exist for append mode
  const isAppendMode = args.includes('--append');
  let existingList = [];
  if (fs.existsSync(reqFilePath)) {
    try {
      const existingData = JSON.parse(fs.readFileSync(reqFilePath, 'utf-8'));
      if (Array.isArray(existingData.requirements)) {
        existingList = existingData.requirements;
      }
    } catch {}
  }

  if (requirementsList.length === 0) {
    const lines = rawInput.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let startIndex = isAppendMode ? existingList.length + 1 : 1;
    for (const line of lines) {
      const cleanText = line.replace(/^(\d+[\.\)]|-|\*)\s*/, '');
      if (cleanText) {
        const id = `R${String(startIndex).padStart(2, '0')}`;
        requirementsList.push({
          id,
          description: cleanText,
          acceptanceCriteria: cleanText,
          priority: 'HIGH',
          type: 'FUNCTIONAL',
          source: 'cli_lock',
        });
        startIndex++;
      }
    }
  }

  if (requirementsList.length === 0) {
    console.error(c.red('❌ Failed to parse any requirements from input.'));
    process.exit(1);
  }

  const finalRequirements = isAppendMode ? [...existingList, ...requirementsList] : requirementsList;
  const checksum = computeChecksum(finalRequirements);
  const data = {
    version: '1.2.0',
    locked: true,
    lockedAt: new Date().toISOString(),
    checksum: checksum,
    description: 'Master Requirements — Locked upfront with SHA-256 checksum',
    requirements: finalRequirements,
  };

  fs.writeFileSync(reqFilePath, JSON.stringify(data, null, 2), 'utf-8');

  console.log(c.green(`✅ Successfully locked ${finalRequirements.length} requirement(s)!`));
  console.log(`   File:     ${c.bold('.ai-testing/configs/requirements.json')}`);
  console.log(`   Checksum: ${c.bold(checksum)}`);
  console.log('');
  finalRequirements.forEach(r => {
    console.log(`   - [${r.id}] ${r.description}`);
  });
  console.log('');
  console.log(c.cyan('👉 You can now start coding. When finished, trigger "verify" to test against this locked baseline.'));
}

// ─── Main ───────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);

  if (args.includes('lock')) {
    handleLockCommand(args);
    return;
  }

  if (args.includes('verify')) {
    const verifyScript = path.join(AI_TESTING_DIR, 'scripts', 'verify.ts');
    if (!fs.existsSync(verifyScript)) {
      console.log(c.yellow('⚠️  Verification scripts not found. Initializing scaffold first...'));
      scaffold();
    }
    execSync('npx tsx .ai-testing/scripts/verify.ts', { cwd: CWD, stdio: 'inherit' });
    return;
  }

  console.log('');
  console.log(c.bold('🧪 AI Dual-Track Testing'));
  console.log(c.dim('   One-command verification skill for Vibe Code projects'));
  console.log('');

  // 1. Detect AI Tool
  console.log(c.cyan('🔍 Detecting AI tool...'));
  let tool = detectAITool();

  if (!tool) {
    console.log(c.yellow('   No AI tool detected. Using generic AGENTS.md'));
    tool = {
      name: 'Generic',
      ruleFile: 'AGENTS.md',
      templateRule: 'antigravity.md',
      inject: 'append',
    };
  } else {
    console.log(c.green(`   ✅ Found: ${tool.name}`));
  }

  // 2. Detect Project
  console.log('');
  console.log(c.cyan('🔍 Detecting project...'));
  const project = detectProject();
  console.log(`   Framework:   ${c.bold(project.framework)}`);
  console.log(`   Language:    ${c.bold(project.language)}`);
  console.log(`   Vitest:      ${project.hasVitest ? c.green('✅ installed') : c.yellow('❌ not found')}`);
  console.log(`   Playwright:  ${project.hasPlaywright ? c.green('✅ installed') : c.yellow('❌ not found')}`);

  // 3. Check flags
  const skipDeps = args.includes('--skip-deps');
  const forceReset = args.includes('--reset');

  // 4. Check if already installed
  if (fs.existsSync(path.join(AI_TESTING_DIR, 'scripts', 'verify.ts')) && !forceReset) {
    console.log('');
    console.log(c.yellow('⚠️  .ai-testing/ already exists. Updating rules & scripts...'));
    scaffold();
    injectRules(tool);
    if (!skipDeps) {
      console.log('');
      console.log(c.cyan('📦 Checking testing tools...'));
      installTestingTools(project);
    }
    console.log('');
    console.log(c.green('✅ Updated.'));
    console.log('');
    return;
  }

  // 4b. Force reset if --reset flag
  if (forceReset && fs.existsSync(AI_TESTING_DIR)) {
    console.log('');
    console.log(c.yellow('🔄 Force reset: removing .ai-testing/...'));
    fs.rmSync(AI_TESTING_DIR, { recursive: true, force: true });
  }

  // 5. Scaffold
  console.log('');
  console.log(c.cyan('📦 Installing AI Testing Skill...'));
  scaffold();

  // 6. Install testing tools
  if (!skipDeps) {
    console.log('');
    console.log(c.cyan('📦 Installing testing tools...'));
    installTestingTools(project);
  } else {
    console.log('');
    console.log(c.dim('   Skipped tool install (--skip-deps)'));
  }

  // 7. Inject rules
  console.log('');
  console.log(c.cyan('📝 Injecting verification rules...'));
  injectRules(tool);

  // 8. Update .gitignore
  console.log('');
  updateGitignore();

  // 9. Done
  console.log('');
  console.log(c.bold(c.green('🎉 Done!')));
  console.log('');
  console.log('   AI sẽ tự biết cách verify khi bạn nói:');
  console.log(c.cyan('   "verify"  "kiểm tra"  "test lại"  "check coverage"'));
  console.log('');
  console.log(c.dim('   Lock requirements trước khi code:'));
  console.log(c.bold('   npx ai-dual-testing lock "<requirements>"'));
  console.log('');
  console.log(c.dim('   Scripts: .ai-testing/scripts/'));
  console.log(c.dim('   Reports: .ai-testing/reports/'));
  console.log(c.dim(`   Rules:   ${tool.ruleFile}`));
  console.log('');
}

if (require.main === module) {
  main();
}

module.exports = {
  detectAITool,
  detectProject,
  injectRules,
  scaffold,
  computeChecksum,
  handleLockCommand,
  updateGitignore,
  AI_TOOLS,
};
