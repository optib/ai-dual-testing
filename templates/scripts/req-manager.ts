/**
 * Requirement Manager (req-manager.ts) — AI Dual-Track Testing
 *
 * Provides auto-ingestion, incremental appending, and SHA-256 locking for requirements.
 * Ensures existing requirements are preserved intact (Append-Only mode).
 *
 * Usage:
 *   npx tsx .ai-testing/scripts/req-manager.ts --append "User can reset password" --ac "Sends reset link"
 *   npx tsx .ai-testing/scripts/req-manager.ts --list
 *   npx tsx .ai-testing/scripts/req-manager.ts --json '[{"description": "Req A", "acceptanceCriteria": "AC A"}]'
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

export interface RequirementItem {
  id: string;
  description: string;
  acceptanceCriteria: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  type: 'FUNCTIONAL' | 'NON_FUNCTIONAL';
  source: string;
}

export interface RequirementsFile {
  version: string;
  locked: boolean;
  lockedAt: string | null;
  checksum: string | null;
  description: string;
  requirements: RequirementItem[];
}

const ROOT = resolve(process.cwd(), '.ai-testing');
const CONFIGS_DIR = resolve(ROOT, 'configs');
const REQUIREMENTS_PATH = resolve(CONFIGS_DIR, 'requirements.json');

export function deterministicStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(deterministicStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + deterministicStringify(obj[k])).join(',') + '}';
}

export function computeRequirementsChecksum(requirements: any[]): string {
  const normalized = deterministicStringify(requirements || []);
  return createHash('sha256').update(normalized).digest('hex');
}

export function loadRequirementsFile(customPath?: string): RequirementsFile {
  const targetPath = customPath || REQUIREMENTS_PATH;
  if (!existsSync(targetPath)) {
    return {
      version: '1.2.0',
      locked: false,
      lockedAt: null,
      checksum: null,
      description: 'Master Requirements — Auto-locked with SHA-256 checksum',
      requirements: [],
    };
  }

  try {
    const raw = readFileSync(targetPath, 'utf-8');
    const data = JSON.parse(raw);
    return {
      version: data.version || '1.2.0',
      locked: !!data.locked,
      lockedAt: data.lockedAt || null,
      checksum: data.checksum || null,
      description: data.description || 'Master Requirements — Auto-locked with SHA-256 checksum',
      requirements: Array.isArray(data.requirements) ? data.requirements : [],
    };
  } catch {
    return {
      version: '1.2.0',
      locked: false,
      lockedAt: null,
      checksum: null,
      description: 'Master Requirements — Auto-locked with SHA-256 checksum',
      requirements: [],
    };
  }
}

export function getNextRequirementId(existingReqs: RequirementItem[]): string {
  let maxNum = 0;
  for (const r of existingReqs) {
    const match = r.id.match(/^R(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return `R${String(maxNum + 1).padStart(2, '0')}`;
}

export function appendRequirements(
  newItems: Array<{ description: string; acceptanceCriteria?: string; priority?: 'HIGH' | 'MEDIUM' | 'LOW'; type?: 'FUNCTIONAL' | 'NON_FUNCTIONAL'; source?: string }>,
  customPath?: string
): { addedCount: number; totalCount: number; checksum: string; items: RequirementItem[] } {
  const targetPath = customPath || REQUIREMENTS_PATH;
  const targetDir = resolve(targetPath, '..');
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  const current = loadRequirementsFile(targetPath);
  const existingList = [...current.requirements];
  const addedItems: RequirementItem[] = [];

  for (const item of newItems) {
    const cleanDesc = (item.description || '').trim();
    if (!cleanDesc) continue;

    // Check if duplicate description exists
    const duplicate = existingList.find(r => r.description.toLowerCase() === cleanDesc.toLowerCase());
    if (duplicate) {
      console.log(`   ℹ️ [SKIP] Requirement already exists: [${duplicate.id}] ${duplicate.description}`);
      continue;
    }

    const nextId = getNextRequirementId([...existingList, ...addedItems]);
    const reqItem: RequirementItem = {
      id: nextId,
      description: cleanDesc,
      acceptanceCriteria: (item.acceptanceCriteria || cleanDesc).trim(),
      priority: item.priority || 'HIGH',
      type: item.type || 'FUNCTIONAL',
      source: item.source || 'auto_ingest',
    };

    addedItems.push(reqItem);
  }

  const updatedList = [...existingList, ...addedItems];
  const checksum = computeRequirementsChecksum(updatedList);

  const updatedFile: RequirementsFile = {
    version: '1.2.0',
    locked: true,
    lockedAt: new Date().toISOString(),
    checksum,
    description: 'Master Requirements — Auto-locked with SHA-256 checksum',
    requirements: updatedList,
  };

  writeFileSync(targetPath, JSON.stringify(updatedFile, null, 2), 'utf-8');

  return {
    addedCount: addedItems.length,
    totalCount: updatedList.length,
    checksum,
    items: addedItems,
  };
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    const current = loadRequirementsFile();
    console.log(`\n📋 Master Requirements (${current.requirements.length} total, locked: ${current.locked})`);
    console.log(`   Checksum: ${current.checksum || 'None'}`);
    console.log('═'.repeat(60));
    current.requirements.forEach(r => {
      console.log(`   - [${r.id}] ${r.description} (AC: ${r.acceptanceCriteria})`);
    });
    console.log('');
    return;
  }

  let appendDesc = '';
  let appendAc = '';
  let rawJson = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--append') {
      const words: string[] = [];
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        words.push(args[i]);
        i++;
      }
      appendDesc = words.join(' ');
      i--;
    } else if (args[i] === '--ac') {
      const words: string[] = [];
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        words.push(args[i]);
        i++;
      }
      appendAc = words.join(' ');
      i--;
    } else if (args[i] === '--json') {
      const words: string[] = [];
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        words.push(args[i]);
        i++;
      }
      rawJson = words.join(' ');
      i--;
    }
  }

  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const result = appendRequirements(items);
      console.log(`✅ [AUTO-LOCK] Successfully added ${result.addedCount} requirement(s). Total: ${result.totalCount}. Checksum: ${result.checksum.slice(0, 10)}...`);
      return;
    } catch (e: any) {
      console.error(`❌ Error parsing JSON input: ${e.message}`);
      process.exit(1);
    }
  }

  if (appendDesc) {
    const result = appendRequirements([{ description: appendDesc, acceptanceCriteria: appendAc || appendDesc }]);
    if (result.addedCount > 0) {
      console.log(`✅ [AUTO-LOCK] Added [${result.items[0].id}] "${result.items[0].description}". Total: ${result.totalCount}. Checksum: ${result.checksum.slice(0, 10)}...`);
    } else {
      console.log(`ℹ️ [AUTO-LOCK] Requirement already registered. Total: ${result.totalCount}.`);
    }
    return;
  }

  console.log('Usage:');
  console.log('  npx tsx .ai-testing/scripts/req-manager.ts --append "User can login" --ac "Validates credentials"');
  console.log('  npx tsx .ai-testing/scripts/req-manager.ts --json \'[{"description": "Req 1"}]\'');
  console.log('  npx tsx .ai-testing/scripts/req-manager.ts --list');
}

if (require.main === module) {
  main();
}
