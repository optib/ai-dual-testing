/**
 * Master RTM Aggregator — AI Dual-Track Testing
 *
 * Aggregates latest individual .rtm.json files and cross-validates against requirements.json.
 * Usage: npx tsx .ai-testing/scripts/master-rtm.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

// ─── Types ───────────────────────────────────────────────
interface Requirement {
  id: string;
  description: string;
  acceptanceCriteria: string;
  testCases: string;
  status: '✅' | '❌' | '⚠️' | 'Chưa test';
  round: number;
  notes: string;
}

interface FeatureRTM {
  feature: string;
  file: string;
  requirements: Requirement[];
}

// ─── Paths ───────────────────────────────────────────────
const ROOT = resolve(process.cwd(), '.ai-testing');
const REPORTS_DIR = resolve(ROOT, 'reports');
const REQUIREMENTS_PATH = resolve(ROOT, 'configs', 'requirements.json');
const MASTER_MD_PATH = resolve(REPORTS_DIR, 'master-rtm.md');

function computeRequirementsChecksum(requirements: any[]): string {
  const normalized = JSON.stringify(requirements || []);
  return createHash('sha256').update(normalized).digest('hex');
}

// ─── Load baseline requirements ──────────────────────────
function loadBaselineRequirements(): { ids: string[]; count: number; checksumValid: boolean } {
  if (!existsSync(REQUIREMENTS_PATH)) {
    console.warn('⚠️  requirements.json not found. Cannot cross-validate.');
    return { ids: [], count: 0, checksumValid: false };
  }
  try {
    const data = JSON.parse(readFileSync(REQUIREMENTS_PATH, 'utf-8'));
    const reqs = data.requirements || [];
    let checksumValid = true;
    if (data.locked && data.checksum) {
      checksumValid = computeRequirementsChecksum(reqs) === data.checksum;
      if (!checksumValid) {
        console.error('❌ FAIL: requirements.json checksum mismatch in master-rtm!');
      }
    }
    return { ids: reqs.map((r: any) => r.id), count: reqs.length, checksumValid };
  } catch {
    return { ids: [], count: 0, checksumValid: false };
  }
}

// ─── Scan latest .rtm.json files per feature ─────────────
function scanLatestRTMFiles(): FeatureRTM[] {
  if (!existsSync(REPORTS_DIR)) return [];

  const files = readdirSync(REPORTS_DIR).filter(
    (f) => f.endsWith('.rtm.json')
  );

  // Group by feature name to pick only the latest timestamped report per feature
  const latestByFeature = new Map<string, { file: string; data: FeatureRTM }>();

  for (const file of files) {
    try {
      const parsed: any = JSON.parse(readFileSync(resolve(REPORTS_DIR, file), 'utf-8'));
      const featureName = parsed.feature || file.replace(/\.rtm\.json$/, '');
      const rtmObj: FeatureRTM = {
        feature: featureName,
        file: file,
        requirements: parsed.requirements || [],
      };

      const existing = latestByFeature.get(featureName);
      if (!existing || file.localeCompare(existing.file) > 0) {
        latestByFeature.set(featureName, { file, data: rtmObj });
      }
    } catch (e) {
      console.warn(`⚠️  Could not parse ${file}: ${(e as Error).message}`);
    }
  }

  return Array.from(latestByFeature.values()).map(v => v.data);
}

// ─── Generate Markdown ───────────────────────────────────
function generateMarkdown(features: FeatureRTM[], baseline: { ids: string[]; count: number; checksumValid: boolean }): string {
  const lines: string[] = ['# 📋 Master RTM', '', `> Updated: ${new Date().toISOString().slice(0, 19)}`, ''];

  let totalReqs = 0, totalPassed = 0, totalFailed = 0, totalPending = 0;
  const allRtmIds = new Set<string>();

  for (const f of features) {
    for (const r of f.requirements) {
      totalReqs++;
      allRtmIds.add(r.id);
      if (r.status === '✅') totalPassed++;
      else if (r.status === '❌') totalFailed++;
      else totalPending++;
    }
  }

  const denominator = baseline.count > 0 ? baseline.count : totalReqs;
  const pct = denominator > 0 ? Math.round((totalPassed / denominator) * 1000) / 10 : 0;

  lines.push('## Summary', '', '| Metric | Value |', '|--------|-------|');
  lines.push(`| Features Tested | ${features.length} |`);
  lines.push(`| Baseline Requirements | ${baseline.count} |`);
  lines.push(`| Requirements in Latest RTM | ${totalReqs} |`);
  lines.push(`| ✅ Passed | ${totalPassed} |`);
  lines.push(`| ❌ Failed | ${totalFailed} |`);
  lines.push(`| ⚠️ Pending | ${totalPending} |`);
  lines.push(`| **Coverage** | **${pct}%** ${pct >= 95 ? '✅' : '❌'} |`, '');

  if (!baseline.checksumValid) {
    lines.push('> 🚨 **INTEGRITY WARNING**: Baseline `requirements.json` failed SHA-256 checksum validation!', '');
  }

  // Cross-validation section
  if (baseline.count > 0) {
    const missingInRtm = baseline.ids.filter(id => !allRtmIds.has(id));
    const orphanInRtm = [...allRtmIds].filter(id => !baseline.ids.includes(id));

    if (missingInRtm.length > 0 || orphanInRtm.length > 0) {
      lines.push('## ⚠️ Cross-Validation Issues', '');
      if (missingInRtm.length > 0) {
        lines.push(`**Missing from RTM** (in requirements.json but not tested): ${missingInRtm.join(', ')}`, '');
      }
      if (orphanInRtm.length > 0) {
        lines.push(`**Orphan in RTM** (tested but not in requirements.json): ${orphanInRtm.join(', ')}`, '');
      }
    }
  }

  lines.push('---');

  for (const f of features) {
    const fp = f.requirements.filter(r => r.status === '✅').length;
    const ft = f.requirements.length;
    lines.push('', `## ${f.feature} (File: \`${f.file}\`)`, '', `**Coverage: ${fp}/${ft} = ${ft > 0 ? Math.round(fp/ft*1000)/10 : 0}%**`, '');
    lines.push('| ID | Requirement | AC | Tests | Status | Notes |');
    lines.push('|----|-----------|----|----|--------|-------|');
    for (const r of f.requirements) {
      lines.push(`| ${r.id} | ${r.description} | ${r.acceptanceCriteria} | ${r.testCases} | ${r.status} | ${r.notes || '—'} |`);
    }
    lines.push('', '---');
  }
  return lines.join('\n');
}

// ─── Main ────────────────────────────────────────────────
function main() {
  console.log('📋 Master RTM Aggregator\n');

  const baseline = loadBaselineRequirements();
  if (baseline.count > 0) {
    console.log(`📌 Baseline: ${baseline.count} requirements from requirements.json`);
  }

  const features = scanLatestRTMFiles();

  if (features.length === 0) {
    console.log('⚠️  No .rtm.json files found in .ai-testing/reports/');
    return;
  }

  console.log(`📂 Found ${features.length} unique feature report(s)`);
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(MASTER_MD_PATH, generateMarkdown(features, baseline), 'utf-8');
  console.log(`📝 Written to: ${MASTER_MD_PATH}`);
}

main();
