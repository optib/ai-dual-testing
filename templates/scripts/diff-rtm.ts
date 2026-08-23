/**
 * RTM Diff & History Auditor — AI Dual-Track Testing
 *
 * Compares RTM historical runs to detect regressions, dropped requirements, or silent status downgrades.
 * Usage: npx tsx .ai-testing/scripts/diff-rtm.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(process.cwd(), '.ai-testing');
const REPORTS_DIR = resolve(ROOT, 'reports');
const DIFF_REPORT_PATH = resolve(REPORTS_DIR, 'rtm-diff-report.md');

interface RequirementItem {
  id: string;
  description: string;
  acceptanceCriteria: string;
  testCases: string;
  status: string;
  notes?: string;
}

function extractTimestamp(filename: string, testedAt?: string): number {
  if (testedAt) {
    const t = new Date(testedAt).getTime();
    if (!isNaN(t)) return t;
  }
  const match = filename.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (match) {
    const d = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00Z`);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  const unixMatch = filename.match(/(\d{10,13})/);
  if (unixMatch) {
    const num = parseInt(unixMatch[1], 10);
    return num < 10000000000 ? num * 1000 : num;
  }
  return 0;
}

interface RTMReport {
  file: string;
  feature: string;
  testedAt: string;
  timestamp: number;
  requirements: RequirementItem[];
}

function parseRtmFile(filename: string): RTMReport | null {
  try {
    const raw = readFileSync(resolve(REPORTS_DIR, filename), 'utf-8');
    const data = JSON.parse(raw);
    const feature = data.feature || filename.replace('.rtm.json', '').replace(/-\d{8}T\d{4}$/, '');
    const testedAt = data.testedAt || '';
    return {
      file: filename,
      feature,
      testedAt,
      timestamp: extractTimestamp(filename, testedAt),
      requirements: data.requirements || [],
    };
  } catch {
    return null;
  }
}

function main() {
  if (!existsSync(REPORTS_DIR)) return;

  const files = readdirSync(REPORTS_DIR).filter(f => f.endsWith('.rtm.json'));
  if (files.length <= 1) {
    console.log('   ℹ️  Fewer than 2 RTM history reports found. Diff not required yet.');
    return;
  }

  // Parse all files
  const reports: RTMReport[] = files
    .map(parseRtmFile)
    .filter((r): r is RTMReport => r !== null);

  // Group by feature
  const byFeature = new Map<string, RTMReport[]>();
  for (const rep of reports) {
    const list = byFeature.get(rep.feature) || [];
    list.push(rep);
    byFeature.set(rep.feature, list);
  }

  const warnings: string[] = [];
  const lines: string[] = [
    '# 🔍 RTM Historical Regression & Diff Report',
    '',
    `> Generated: ${new Date().toISOString()}`,
    '',
  ];

  for (const [feature, featureReports] of byFeature.entries()) {
    if (featureReports.length < 2) continue;

    // Sort ascending by timestamp
    featureReports.sort((a, b) => a.timestamp - b.timestamp || a.file.localeCompare(b.file));
    const previous = featureReports[featureReports.length - 2];
    const current = featureReports[featureReports.length - 1];

    lines.push(`## Feature: ${feature}`);
    lines.push(`- Previous run: \`${previous.file}\` (${previous.requirements.length} reqs)`);
    lines.push(`- Current run: \`${current.file}\` (${current.requirements.length} reqs)`);
    lines.push('');

    // Check dropped requirements
    const prevMap = new Map(previous.requirements.map(r => [r.id, r]));
    const currMap = new Map(current.requirements.map(r => [r.id, r]));

    const droppedReqs = previous.requirements.filter(r => !currMap.has(r.id));
    if (droppedReqs.length > 0) {
      const msg = `🚨 [REGRESSION] Feature "${feature}": ${droppedReqs.length} requirement(s) dropped in current run: ${droppedReqs.map(r => r.id).join(', ')}`;
      warnings.push(msg);
      lines.push(`> ⚠️ **DROPPED REQUIREMENTS**: ${droppedReqs.map(r => `${r.id} (${r.description})`).join(', ')}`);
    }

    // Check status changes
    for (const [id, prevReq] of prevMap.entries()) {
      const currReq = currMap.get(id);
      if (currReq) {
        if (prevReq.status === '✅' && currReq.status !== '✅') {
          const msg = `⚠️ [STATUS DOWNGRADE] Feature "${feature}" - Requirement ${id} changed from ✅ to ${currReq.status}`;
          warnings.push(msg);
          lines.push(`- **${id}**: Status downgraded from \`${prevReq.status}\` to \`${currReq.status}\` (${currReq.notes || 'No note'})`);
        }
      }
    }
    lines.push('');
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  RTM Historical Audit Warnings:');
    for (const w of warnings) {
      console.warn(`   ${w}`);
    }
  } else {
    console.log('   ✅ RTM history audit: No regressions detected across runs.');
  }

  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(DIFF_REPORT_PATH, lines.join('\n'), 'utf-8');

  if (warnings.length > 0) {
    process.exit(1);
  }
}

main();
