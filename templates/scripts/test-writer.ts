/**
 * Test Writer & Merger — AI Dual-Track Testing
 *
 * Safely creates or appends test cases to .ai-testing/e2e/{feature}.spec.ts without overwriting existing tests.
 * Performs static analysis to REJECT dummy / tautological tests (e.g. expect(true).toBe(true)).
 *
 * Usage:
 *   npx tsx .ai-testing/scripts/test-writer.ts --feature <feature> --code "<test code>"
 *   npx tsx .ai-testing/scripts/test-writer.ts --feature <feature> --file <temp-test-file>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { auditTestCode, AuditViolation } from './test-auditor';

const ROOT = resolve(process.cwd(), '.ai-testing');
const E2E_DIR = resolve(ROOT, 'e2e');

export function extractTestTitles(content: string): string[] {
  const titles: string[] = [];
  const testRegex = /(?:test|it)(?:\.only|\.skip)?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = testRegex.exec(content)) !== null) {
    if (match[2]) {
      titles.push(match[2].trim());
    }
  }
  return titles;
}

export function mergeTestCode(existingContent: string, newSnippet: string): { updatedContent: string; appendedCount: number; duplicateCount: number } {
  let snippetToAppend = newSnippet.trim();

  // Clean up duplicate imports from snippet if existing content already has them
  if (existingContent.includes('@playwright/test')) {
    snippetToAppend = snippetToAppend
      .replace(/import\s*\{[^}]*\}\s*from\s*['"]@playwright\/test['"];?/g, '')
      .trim();
  }

  if (!snippetToAppend) {
    return { updatedContent: existingContent, appendedCount: 0, duplicateCount: 0 };
  }

  const existingTitles = extractTestTitles(existingContent);
  const incomingTitles = extractTestTitles(snippetToAppend);

  if (snippetToAppend.includes('test(') || snippetToAppend.includes('it(')) {
    if (incomingTitles.length === 0) {
      console.warn('   ⚠️ [WARNING] Could not parse test title from snippet. Appending snippet directly.');
    }
  }

  // Check for duplicate test titles
  const duplicateTitles = incomingTitles.filter(title => existingTitles.includes(title));
  if (duplicateTitles.length > 0) {
    console.log(`   ℹ️ [SKIPPED] Test case(s) already exist in file: ${duplicateTitles.map(t => `"${t}"`).join(', ')}`);
    if (incomingTitles.length > 0 && duplicateTitles.length === incomingTitles.length) {
      return { updatedContent: existingContent, appendedCount: 0, duplicateCount: duplicateTitles.length };
    }
  }

  const base = existingContent.trimEnd();
  const updatedContent = `${base}\n\n${snippetToAppend}\n`;
  const appendedCount = incomingTitles.length - duplicateTitles.length;

  return { updatedContent, appendedCount: Math.max(1, appendedCount), duplicateCount: duplicateTitles.length };
}

export function writeOrMergeTest(feature: string, testCode: string): { created: boolean; merged: boolean; path: string; duplicateCount: number; rejected?: boolean; violations?: AuditViolation[] } {
  // ─── STATIC ANALYSIS PRE-CHECK (LAYER 1) ─────────────────
  const audit = auditTestCode(testCode);
  if (!audit.valid) {
    console.error(`\n❌ [STATIC AUDIT REJECTED] Dummy or tautological test detected in feature "${feature}":`);
    for (const v of audit.violations) {
      console.error(`   - Test: "${v.testTitle}"`);
      console.error(`     Reason: [${v.type}] ${v.details}`);
      if (v.snippet) console.error(`     Snippet: ${v.snippet}`);
    }
    console.error('   Action: Tests must interact with real DOM elements or assert dynamic values.\n');
    return { created: false, merged: false, path: '', duplicateCount: 0, rejected: true, violations: audit.violations };
  }

  if (!existsSync(E2E_DIR)) {
    mkdirSync(E2E_DIR, { recursive: true });
  }

  const cleanFeature = feature.replace(/[\/\\:*?"<>|]/g, '-').replace(/\.spec\.(ts|js)$/, '');
  const filePath = resolve(E2E_DIR, `${cleanFeature}.spec.ts`);

  if (!existsSync(filePath)) {
    let initialContent = testCode.trim();
    if (!initialContent.includes('@playwright/test')) {
      initialContent = `import { test, expect } from '@playwright/test';\n\n${initialContent}\n`;
    } else {
      initialContent = `${initialContent}\n`;
    }
    writeFileSync(filePath, initialContent, 'utf-8');
    return { created: true, merged: false, path: filePath, duplicateCount: 0 };
  }

  // File already exists -> MERGE
  const existingContent = readFileSync(filePath, 'utf-8');
  const mergeResult = mergeTestCode(existingContent, testCode);
  writeFileSync(filePath, mergeResult.updatedContent, 'utf-8');
  return { created: false, merged: true, path: filePath, duplicateCount: mergeResult.duplicateCount };
}

function main() {
  const args = process.argv.slice(2);
  let feature = '';
  let testCode = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--feature' && args[i + 1]) {
      feature = args[i + 1];
      i++;
    } else if (args[i] === '--code' && args[i + 1]) {
      testCode = args[i + 1];
      i++;
    } else if (args[i] === '--file' && args[i + 1]) {
      const srcFile = resolve(process.cwd(), args[i + 1]);
      if (existsSync(srcFile)) {
        testCode = readFileSync(srcFile, 'utf-8');
      }
      i++;
    }
  }

  if (!feature || !testCode) {
    console.error('❌ Error: Missing --feature or --code / --file argument.');
    console.log('Usage:');
    console.log('  npx tsx .ai-testing/scripts/test-writer.ts --feature login --code "test(\'login\', async () => {})"');
    console.log('  npx tsx .ai-testing/scripts/test-writer.ts --feature login --file temp-test.ts');
    process.exit(1);
  }

  const result = writeOrMergeTest(feature, testCode);
  if (result.rejected) {
    process.exit(1);
  }

  if (result.created) {
    console.log(`✅ Created test file: ${result.path}`);
  } else {
    console.log(`✅ Processed test for ${result.path} (existing tests preserved, ${result.duplicateCount} duplicate(s) skipped)`);
  }
}

if (require.main === module) {
  main();
}
