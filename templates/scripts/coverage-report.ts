/**
 * Dual Coverage Report — AI Dual-Track Testing
 *
 * Reads Vitest coverage + RTM data + requirements.json baseline.
 * Usage: npx tsx .ai-testing/scripts/coverage-report.ts
 * Exit: 0 = PASS, 1 = FAIL
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

const ROOT = resolve(process.cwd(), '.ai-testing');
const THRESHOLDS_PATH = resolve(ROOT, 'configs', 'thresholds.json');
const REQUIREMENTS_PATH = resolve(ROOT, 'configs', 'requirements.json');
const COVERAGE_PATH = resolve(process.cwd(), 'coverage', 'coverage-summary.json');
const REPORTS_DIR = resolve(ROOT, 'reports');
const OUTPUT_PATH = resolve(REPORTS_DIR, 'coverage-report.md');

interface Thresholds {
  codeCoverage: { lines: number; branches: number; functions: number; statements: number };
  requirementCoverage: { minimum: number };
}

function computeRequirementsChecksum(requirements: any[]): string {
  const normalized = JSON.stringify(requirements || []);
  return createHash('sha256').update(normalized).digest('hex');
}

function loadThresholds(): Thresholds {
  if (!existsSync(THRESHOLDS_PATH)) {
    return { codeCoverage: { lines: 80, branches: 75, functions: 80, statements: 80 }, requirementCoverage: { minimum: 95 } };
  }
  return JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf-8'));
}

function loadBaseline(): { count: number; validChecksum: boolean } {
  if (!existsSync(REQUIREMENTS_PATH)) return { count: 0, validChecksum: false };
  try {
    const data = JSON.parse(readFileSync(REQUIREMENTS_PATH, 'utf-8'));
    const reqs = data.requirements || [];
    let validChecksum = true;
    if (data.locked && data.checksum) {
      validChecksum = computeRequirementsChecksum(reqs) === data.checksum;
    }
    return { count: reqs.length, validChecksum };
  } catch {
    return { count: 0, validChecksum: false };
  }
}

function parseCodeCoverage(t: Thresholds) {
  if (!existsSync(COVERAGE_PATH)) {
    console.warn('⚠️  No code coverage. Run "npx vitest --coverage" first.');
    return { results: [], available: false };
  }
  const data = JSON.parse(readFileSync(COVERAGE_PATH, 'utf-8'));
  const total = data.total;
  const metrics = [
    { key: 'lines', label: 'Lines' }, { key: 'branches', label: 'Branches' },
    { key: 'functions', label: 'Functions' }, { key: 'statements', label: 'Statements' },
  ];
  return {
    results: metrics.map(({ key, label }) => {
      const actual = total[key]?.pct ?? 0;
      const threshold = (t.codeCoverage as any)[key];
      return { metric: label, actual, threshold, pass: actual >= threshold };
    }),
    available: true,
  };
}

function parseRTMCoverage(t: Thresholds, baselineCount: number) {
  if (!existsSync(REPORTS_DIR)) return { total: 0, passed: 0, pct: 0, pass: false, available: false, baseline: baselineCount };
  const files = readdirSync(REPORTS_DIR).filter(f => f.endsWith('.rtm.json'));
  
  // Pick latest file per feature
  const latestByFeature = new Map<string, any>();
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(resolve(REPORTS_DIR, file), 'utf-8'));
      const feature = data.feature || file;
      const existing = latestByFeature.get(feature);
      if (!existing || file.localeCompare(existing.file) > 0) {
        latestByFeature.set(feature, { file, data });
      }
    } catch {}
  }

  let total = 0, passed = 0;
  for (const { data } of latestByFeature.values()) {
    for (const r of data.requirements || []) {
      total++;
      if (r.status === '✅') passed++;
    }
  }

  const denominator = baselineCount > 0 ? baselineCount : total;
  const pct = denominator > 0 ? Math.round((passed / denominator) * 1000) / 10 : 0;
  return { total, passed, pct, pass: pct >= t.requirementCoverage.minimum, available: total > 0, baseline: baselineCount };
}

function main() {
  console.log('📊 Dual Coverage Report\n');
  const t = loadThresholds();
  const baseline = loadBaseline();
  const code = parseCodeCoverage(t);
  const rtm = parseRTMCoverage(t, baseline.count);

  const lines: string[] = ['# 📊 Dual Coverage Report', '', `> Generated: ${new Date().toISOString().slice(0, 19)}`, ''];

  if (baseline.count > 0) {
    lines.push(`> Baseline: ${baseline.count} requirements from requirements.json (Integrity: ${baseline.validChecksum ? '✅ Verified' : '❌ Checksum Failed'})`, '');
  }

  // Code Coverage
  lines.push('## Code Coverage', '');
  if (code.available) {
    lines.push('| Metric | Actual | Threshold | Status |', '|--------|--------|-----------|--------|');
    for (const r of code.results) lines.push(`| ${r.metric} | ${r.actual.toFixed(1)}% | ${r.threshold}% | ${r.pass ? '✅' : '❌'} |`);
  } else {
    lines.push('> ⚠️ No code coverage data. Run `npx vitest --coverage`.');
  }

  // RTM Coverage
  lines.push('', '## Requirement Coverage', '');
  if (rtm.available) {
    lines.push(`- Baseline (requirements.json): ${rtm.baseline}`);
    lines.push(`- Tested: ${rtm.total}`);
    lines.push(`- Passed: ${rtm.passed}`);
    lines.push(`- Coverage: **${rtm.pct}%** ${rtm.pass ? '✅' : '❌'}`);
    if (rtm.total < rtm.baseline) {
      lines.push(`- ⚠️ Warning: Only ${rtm.total}/${rtm.baseline} requirements found in RTM files`);
    }
  } else {
    lines.push('> ⚠️ No RTM data.');
  }

  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, lines.join('\n'), 'utf-8');
  console.log(`📝 Report: ${OUTPUT_PATH}`);

  const codePass = !code.available || code.results.every(r => r.pass);
  const rtmPass = !rtm.available || rtm.pass;
  const integrityPass = baseline.validChecksum;

  console.log(`\n📦 Code: ${code.available ? (codePass ? '✅ PASS' : '❌ FAIL') : '⚠️ N/A'}`);
  console.log(`📋 RTM: ${rtm.available ? `${rtm.pct}% ${rtm.pass ? '✅' : '❌'}` : '⚠️ N/A'}`);
  console.log(`🔒 Integrity: ${integrityPass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`\n🏁 Overall: ${codePass && rtmPass && integrityPass ? '✅ PASS' : '❌ FAIL'}\n`);

  process.exit(codePass && rtmPass && integrityPass ? 0 : 1);
}

main();
