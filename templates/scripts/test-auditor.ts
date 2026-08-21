/**
 * Test Auditor — Static Analysis Engine for AI Dual-Track Testing
 *
 * Scans test files/snippets for:
 * 1. Tautological / always-true assertions (e.g. expect(true).toBe(true), expect(1).toBe(1)).
 * 2. Missing assertions (tests with no expect or assert).
 * 3. Hollow Playwright tests (no DOM interactions, locators, or API checks).
 *
 * Zero external dependencies.
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

export interface AuditViolation {
  testTitle: string;
  type: 'TAUTOLOGICAL_ASSERTION' | 'NO_ASSERTIONS' | 'HOLLOW_PLAYWRIGHT_TEST';
  details: string;
  snippet?: string;
}

export interface AuditResult {
  valid: boolean;
  totalTests: number;
  validTests: number;
  violations: AuditViolation[];
}

const DEFAULT_TAUTOLOGICAL_PATTERNS = [
  /^expect\s*\(\s*true\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*true\s*\)/,
  /^expect\s*\(\s*false\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*false\s*\)/,
  /^expect\s*\(\s*null\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual|toBeNull)\s*\(\s*(?:null)?\s*\)/,
  /^expect\s*\(\s*undefined\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual|toBeUndefined)\s*\(\s*(?:undefined)?\s*\)/,
  /^expect\s*\(\s*(['"`])(.*?)\1\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\2\1\s*\)/,
  /^expect\s*\(\s*(\d+(?:\.\d+)?)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\s*\(\s*\1\s*\)/,
  /^expect\s*\(\s*true\s*\)\s*\.\s*toBeTruthy\s*\(\s*\)/,
  /^expect\s*\(\s*false\s*\)\s*\.\s*toBeFalsy\s*\(\s*\)/,
  /^assert\s*\.\s*(?:strictEqual|equal|deepEqual|deepStrictEqual)\s*\(\s*([^,]+)\s*,\s*\1\s*\)/,
  /^assert\s*\.\s*ok\s*\(\s*true\s*\)/,
];

export function loadTautologicalPatterns(customConfigPath?: string): RegExp[] {
  const configPath = customConfigPath || resolve(process.cwd(), '.ai-testing', 'configs', 'thresholds.json');
  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
      const patterns = raw.staticAnalysis?.tautologicalPatterns;
      if (Array.isArray(patterns) && patterns.length > 0) {
        return patterns.map((p: string) => new RegExp(p));
      }
    } catch {}
  }
  return DEFAULT_TAUTOLOGICAL_PATTERNS;
}

interface TestBlock {
  title: string;
  body: string;
}

export function extractTestBlocks(code: string): TestBlock[] {
  const blocks: TestBlock[] = [];
  // Matches test('...', ...) or it('...', ...) with arrow function or function keyword
  const testHeaderRegex = /(?:test|it)(?:\.only|\.skip)?\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>\s*\{/g;

  let match: RegExpExecArray | null;
  while ((match = testHeaderRegex.exec(code)) !== null) {
    const title = match[2];
    const startIndex = match.index + match[0].length;
    let braceCount = 1;
    let endIndex = startIndex;

    for (let i = startIndex; i < code.length; i++) {
      if (code[i] === '{') braceCount++;
      else if (code[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIndex = i;
          break;
        }
      }
    }

    const body = code.substring(startIndex, endIndex);
    blocks.push({ title, body });
  }

  return blocks;
}

export function isAssertionTautological(assertionLine: string, patterns: RegExp[]): boolean {
  const clean = assertionLine.trim().replace(/;$/, '');
  return patterns.some(pattern => pattern.test(clean));
}

export function extractAssertionStatements(testBody: string): string[] {
  const lines: string[] = [];
  const regex = /(?:expect\s*\(|assert\s*\.)[^;]+;?/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(testBody)) !== null) {
    lines.push(m[0].trim());
  }
  return lines;
}

export function auditTestBlock(test: TestBlock, patterns: RegExp[]): AuditViolation | null {
  const body = test.body;
  const assertions = extractAssertionStatements(body);

  // 1. Check if test has zero assertions
  const hasPageSnapshot = body.includes('screenshot(');
  if (assertions.length === 0 && !hasPageSnapshot) {
    return {
      testTitle: test.title,
      type: 'NO_ASSERTIONS',
      details: 'Test body contains 0 assertions (no expect() or assert.* calls).',
    };
  }

  // 2. Check if all assertions in test are tautological
  if (assertions.length > 0) {
    const tautologicalCount = assertions.filter(a => isAssertionTautological(a, patterns)).length;
    if (tautologicalCount === assertions.length) {
      return {
        testTitle: test.title,
        type: 'TAUTOLOGICAL_ASSERTION',
        details: `All ${assertions.length} assertion(s) in test are tautological constants (e.g. ${assertions[0]}).`,
        snippet: assertions.join('; '),
      };
    }
  }

  // 3. Check for hollow Playwright tests (uses page fixture but no DOM/API interactions)
  const isPlaywrightTest = body.includes('page.') || body.includes('page)');
  if (isPlaywrightTest) {
    const hasDomInteraction =
      body.includes('locator(') ||
      body.includes('getBy') ||
      body.includes('.$') ||
      body.includes('.click(') ||
      body.includes('.fill(') ||
      body.includes('.type(') ||
      body.includes('.press(') ||
      body.includes('.check(') ||
      body.includes('.selectOption(') ||
      body.includes('.waitFor') ||
      body.includes('.textContent(') ||
      body.includes('.innerText(') ||
      body.includes('.getAttribute(') ||
      body.includes('.inputValue(') ||
      body.includes('.evaluate(') ||
      body.includes('.request.') ||
      body.includes('.route(');

    // If only page.goto('/') with no DOM locator/action/content check and tautological assertions
    if (!hasDomInteraction && !hasPageSnapshot) {
      // Check if assertions are checking dynamic response objects
      const checksDynamicContent = assertions.some(a => !isAssertionTautological(a, patterns) && (a.includes('status') || a.includes('json') || a.includes('body') || a.includes('text')));
      if (!checksDynamicContent) {
        return {
          testTitle: test.title,
          type: 'HOLLOW_PLAYWRIGHT_TEST',
          details: 'Playwright test does not interact with any DOM elements, locators, or API responses.',
        };
      }
    }
  }

  return null;
}

export function auditTestCode(code: string, configPath?: string): AuditResult {
  const patterns = loadTautologicalPatterns(configPath);
  const blocks = extractTestBlocks(code);
  const violations: AuditViolation[] = [];

  // If code contains test syntax but extractTestBlocks found none (e.g. single expression snippet)
  if (blocks.length === 0 && (code.includes('test(') || code.includes('it('))) {
    const assertions = extractAssertionStatements(code);
    if (assertions.length > 0 && assertions.every(a => isAssertionTautological(a, patterns))) {
      violations.push({
        testTitle: 'inline-test-snippet',
        type: 'TAUTOLOGICAL_ASSERTION',
        details: `Tautological assertion in snippet: ${assertions[0]}`,
        snippet: assertions[0],
      });
      return { valid: false, totalTests: 1, validTests: 0, violations };
    }
  }

  for (const block of blocks) {
    const v = auditTestBlock(block, patterns);
    if (v) violations.push(v);
  }

  return {
    valid: violations.length === 0,
    totalTests: blocks.length,
    validTests: blocks.length - violations.length,
    violations,
  };
}

export function auditAllE2ETests(e2eDir: string, configPath?: string): { valid: boolean; totalFiles: number; fileViolations: Map<string, AuditViolation[]> } {
  const fileViolations = new Map<string, AuditViolation[]>();
  if (!existsSync(e2eDir)) {
    return { valid: true, totalFiles: 0, fileViolations };
  }

  const files = readdirSync(e2eDir).filter(f => f.endsWith('.spec.ts') || f.endsWith('.spec.js') || f.endsWith('.test.ts') || f.endsWith('.test.js'));

  for (const file of files) {
    const fullPath = resolve(e2eDir, file);
    try {
      const content = readFileSync(fullPath, 'utf-8');
      const result = auditTestCode(content, configPath);
      if (!result.valid) {
        fileViolations.set(file, result.violations);
      }
    } catch {}
  }

  return {
    valid: fileViolations.size === 0,
    totalFiles: files.length,
    fileViolations,
  };
}
