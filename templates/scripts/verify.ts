/**
 * Verify Script — AI Dual-Track Testing
 *
 * Orchestrates: Integrity Check → Static Analysis Audit (Anti-Dummy Test) → Run Tests (Enforce Exit Code) → Aggregate RTM → Generate Coverage Report.
 * Usage: npx tsx .ai-testing/scripts/verify.ts
 * Exit: 0 = PASS, 1 = FAIL
 */

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { auditAllE2ETests } from './test-auditor';

const CWD = process.cwd();
const ROOT = resolve(CWD, '.ai-testing');
const REPORTS_DIR = resolve(ROOT, 'reports');
const SCREENSHOTS_DIR = resolve(REPORTS_DIR, 'screenshots');
const PKG_PATH = resolve(CWD, 'package.json');
const REQUIREMENTS_PATH = resolve(ROOT, 'configs', 'requirements.json');

function computeRequirementsChecksum(requirements: any[]): string {
  const normalized = JSON.stringify(requirements || []);
  return createHash('sha256').update(normalized).digest('hex');
}

function runCommandStrict(cmd: string): { success: boolean; error?: string } {
  try {
    console.log(`   $ ${cmd}`);
    execSync(cmd, { cwd: CWD, stdio: 'inherit' });
    return { success: true };
  } catch (e: any) {
    const msg = e.message || `Command failed: ${cmd}`;
    console.error(`\n❌ [TEST FAILURE] Execution failed for command: ${cmd}`);
    return { success: false, error: msg };
  }
}

// ─── PRE-VALIDATION & INTEGRITY CHECK ───────────────────
function preValidate(): { valid: boolean; reqCount: number; reqIds: string[]; error?: string } {
  console.log('\n🔍 Pre-validation & Integrity Check...\n');

  if (!existsSync(REQUIREMENTS_PATH)) {
    const error = 'requirements.json not found in .ai-testing/configs/. Run `npx ai-dual-testing lock` or populate requirements first.';
    console.error(`❌ FAIL: ${error}`);
    return { valid: false, reqCount: 0, reqIds: [], error };
  }

  let reqData: any;
  try {
    reqData = JSON.parse(readFileSync(REQUIREMENTS_PATH, 'utf-8'));
  } catch (e) {
    const error = 'requirements.json is not valid JSON.';
    console.error(`❌ FAIL: ${error}`);
    return { valid: false, reqCount: 0, reqIds: [], error };
  }

  const reqs = reqData.requirements || [];
  if (reqs.length === 0) {
    const error = 'requirements.json has 0 requirements.';
    console.error(`❌ FAIL: ${error}`);
    return { valid: false, reqCount: 0, reqIds: [], error };
  }

  // Integrity Check if locked and checksum exists
  if (reqData.locked && reqData.checksum) {
    const currentHash = computeRequirementsChecksum(reqs);
    if (currentHash !== reqData.checksum) {
      const error = 'requirements.json checksum mismatch! Requirements were tampered with after lock.';
      console.error(`❌ FAIL: ${error}`);
      console.error(`   Expected: ${reqData.checksum}`);
      console.error(`   Actual:   ${currentHash}`);
      return { valid: false, reqCount: reqs.length, reqIds: [], error };
    }
    console.log(`   🔒 Integrity verified: Checksum match (${reqData.checksum.slice(0, 10)}...)`);
  }

  const reqIds = reqs.map((r: any) => r.id);
  console.log(`   ✅ requirements.json: ${reqs.length} requirements (locked: ${reqData.locked || false})`);

  return { valid: true, reqCount: reqs.length, reqIds };
}

function main() {
  console.log('\n🔍 AI Dual-Track Verification Runner');
  console.log('═'.repeat(50));

  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  // 1. PRE-VALIDATE & INTEGRITY CHECK
  const validation = preValidate();
  if (!validation.valid) {
    console.error('\n' + '═'.repeat(50));
    console.error(`\n❌ Pre-validation FAILED: ${validation.error}\n`);
    process.exit(1);
  }

  // 2. LAYER 2: STATIC ANALYSIS AUDIT (ANTI-DUMMY TEST)
  const e2eDir = resolve(ROOT, 'e2e');
  if (!existsSync(e2eDir)) mkdirSync(e2eDir, { recursive: true });
  const thresholdsPath = resolve(ROOT, 'configs', 'thresholds.json');

  console.log('\n🔍 Static Analysis Audit (Anti-Dummy Test Detection)...');
  const audit = auditAllE2ETests(e2eDir, thresholdsPath);

  if (!audit.valid) {
    console.error('\n❌ [STATIC AUDIT FAILED] Dummy / Tautological tests detected in test suite:');
    for (const [file, violations] of audit.fileViolations.entries()) {
      console.error(`\n   📁 File: .ai-testing/e2e/${file}`);
      for (const v of violations) {
        console.error(`      - Test: "${v.testTitle}"`);
        console.error(`        Type: ${v.type}`);
        console.error(`        Detail: ${v.details}`);
        if (v.snippet) console.error(`        Snippet: ${v.snippet}`);
      }
    }
    console.error('\n🚨 Verification REJECTED: Test suite contains fake or empty tests designed to inflate results.\n');
    process.exit(1);
  } else {
    console.log(`   ✅ Static audit passed: ${audit.totalFiles} spec file(s) checked, 0 dummy tests found.`);
  }

  // 3. Detect Installed Test Tools
  let hasVitest = false;
  let hasPlaywright = false;

  if (existsSync(PKG_PATH)) {
    try {
      const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      hasVitest = !!deps['vitest'];
      hasPlaywright = !!deps['@playwright/test'];
    } catch {}
  }

  let testExecutionFailed = false;
  const executionErrors: string[] = [];

  // 4. Execute Automated Tests with STRICT EXIT CODE CHECKING
  if (hasVitest) {
    console.log('\n⚡ Running Vitest Unit Tests (Exit code enforced)...');
    const result = runCommandStrict('npx vitest run');
    if (!result.success) {
      testExecutionFailed = true;
      executionErrors.push('Vitest unit tests failed or crashed with non-zero exit code');
    }
  }

  let e2eSpecs = readdirSync(e2eDir).filter(f => f.endsWith('.spec.ts') || f.endsWith('.spec.js'));

  if (hasPlaywright) {
    if (e2eSpecs.length === 0) {
      const smokeSpecPath = resolve(e2eDir, 'smoke.spec.ts');
      const smokeContent = `import { test, expect } from '@playwright/test';

test('Smoke E2E Test — Homepage UI verification & screenshot', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status() || 200).toBeLessThan(400);
  await page.screenshot({ path: '.ai-testing/reports/screenshots/homepage-smoke.png', fullPage: true });
});
`;
      try {
        writeFileSync(smokeSpecPath, smokeContent, 'utf-8');
        console.log('   ✅ Preserved default .ai-testing/e2e/smoke.spec.ts');
        e2eSpecs = ['smoke.spec.ts'];
      } catch (e) {}
    }

    console.log(`\n🎭 Running Playwright E2E Tests (${e2eSpecs.length} spec file(s)) (Exit code enforced)...`);
    const configFile = resolve(ROOT, 'configs', 'playwright.config.ts');
    const configFlag = existsSync(configFile) ? `--config "${configFile}"` : '';
    const result = runCommandStrict(`npx playwright test "${e2eDir}" ${configFlag}`);
    if (!result.success) {
      testExecutionFailed = true;
      executionErrors.push('Playwright E2E tests failed or crashed with non-zero exit code');
    }
  }

  // 5. Parse RTM files
  const rtmFiles = existsSync(REPORTS_DIR)
    ? readdirSync(REPORTS_DIR).filter(f => f.endsWith('.rtm.json'))
    : [];

  let rtmPassCount = 0;
  let totalReportedReqs = 0;

  if (rtmFiles.length === 0) {
    console.log('\n⚠️  No .rtm.json files found in .ai-testing/reports/');
  } else {
    console.log(`\n📋 Found ${rtmFiles.length} RTM file(s) for documentation & traceability.`);
    const rtmReqIds = new Set<string>();

    for (const file of rtmFiles) {
      try {
        const data = JSON.parse(readFileSync(resolve(REPORTS_DIR, file), 'utf-8'));
        for (const r of data.requirements || []) {
          rtmReqIds.add(r.id);
          totalReportedReqs++;
          if (r.status === '✅') rtmPassCount++;
        }
      } catch (e) {
        console.warn(`⚠️  Could not parse ${file}`);
      }
    }

    const missingInRtm = validation.reqIds.filter(id => !rtmReqIds.has(id));
    if (missingInRtm.length > 0) {
      console.warn(`   ⚠️ Missing requirement IDs in RTM reports: ${missingInRtm.join(', ')}`);
    }
  }

  // 6. Aggregate Master RTM & Coverage Report & Diff
  const masterRtmScript = resolve(ROOT, 'scripts', 'master-rtm.ts');
  if (existsSync(masterRtmScript)) {
    console.log('\n📝 Generating Master RTM...');
    runCommandStrict(`npx tsx "${masterRtmScript}"`);
  }

  const coverageReportScript = resolve(ROOT, 'scripts', 'coverage-report.ts');
  if (existsSync(coverageReportScript)) {
    console.log('\n📊 Generating Dual Coverage Report...');
    runCommandStrict(`npx tsx "${coverageReportScript}"`);
  }

  const diffRtmScript = resolve(ROOT, 'scripts', 'diff-rtm.ts');
  if (existsSync(diffRtmScript)) {
    console.log('\n🔍 Checking RTM History & Regressions...');
    runCommandStrict(`npx tsx "${diffRtmScript}"`);
  }

  // 7. Final Verdict based on:
  // - Real Exit Codes of Test Runners (Vitest & Playwright)
  // - No Integrity Check Failures
  // - No Static Analysis Dummy Test Violations
  const isPass = !testExecutionFailed;

  console.log('\n' + '═'.repeat(50));
  if (!isPass) {
    console.error('\n🏁 Verification Result: ❌ FAIL');
    for (const err of executionErrors) {
      console.error(`   - ${err}`);
    }
    console.error('\nExit code determined by actual test runner status.\n');
    process.exit(1);
  } else {
    console.log('\n🏁 Verification Result: ✅ PASS');
    console.log('   All automated test suites exited with code 0.\n');
    process.exit(0);
  }
}

main();
