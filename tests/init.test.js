const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const {
  detectAITool,
  detectProject,
  injectRules,
  scaffold,
  computeChecksum,
  handleLockCommand,
  AI_TOOLS,
} = require('../bin/init.js');

describe('AI Dual-Testing Core Logic & Verification Integrity', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-testing-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('detectAITool detects Cursor via .cursorrules', () => {
    fs.writeFileSync(path.join(tmpDir, '.cursorrules'), '# cursor rules');
    const tool = detectAITool(tmpDir);
    assert.ok(tool);
    assert.strictEqual(tool.name, 'Cursor');
  });

  test('detectAITool detects Claude Code via CLAUDE.md', () => {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# claude rules');
    const tool = detectAITool(tmpDir);
    assert.ok(tool);
    assert.strictEqual(tool.name, 'Claude Code');
  });

  test('detectAITool detects Windsurf via .windsurfrules', () => {
    fs.writeFileSync(path.join(tmpDir, '.windsurfrules'), '# windsurf rules');
    const tool = detectAITool(tmpDir);
    assert.ok(tool);
    assert.strictEqual(tool.name, 'Windsurf');
  });

  test('detectAITool detects Antigravity via .agents dir', () => {
    fs.mkdirSync(path.join(tmpDir, '.agents'), { recursive: true });
    const tool = detectAITool(tmpDir);
    assert.ok(tool);
    assert.strictEqual(tool.name, 'Antigravity');
  });

  test('injectRules is idempotent (no duplication when run multiple times)', () => {
    const claudeTool = AI_TOOLS.find(t => t.name === 'Claude Code');
    const targetFile = path.join(tmpDir, 'CLAUDE.md');

    // Run 1
    injectRules(claudeTool, tmpDir);
    const content1 = fs.readFileSync(targetFile, 'utf-8');
    const markerCount1 = (content1.match(/<!-- AI-DUAL-TESTING-START -->/g) || []).length;
    assert.strictEqual(markerCount1, 1);

    // Run 2
    injectRules(claudeTool, tmpDir);
    const content2 = fs.readFileSync(targetFile, 'utf-8');
    const markerCount2 = (content2.match(/<!-- AI-DUAL-TESTING-START -->/g) || []).length;
    assert.strictEqual(markerCount2, 1);
  });

  test('computeChecksum generates deterministic SHA-256 hash', () => {
    const reqs = [
      { id: 'R01', description: 'User login' },
      { id: 'R02', description: 'User logout' },
    ];
    const hash1 = computeChecksum(reqs);
    const hash2 = computeChecksum(reqs);
    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64);
  });

  test('handleLockCommand creates requirements.json with valid checksum and locked: true', () => {
    const rawReqs = '1. User can register account\n2. User can login';
    handleLockCommand(['lock', rawReqs], tmpDir);

    const reqFile = path.join(tmpDir, '.ai-testing', 'configs', 'requirements.json');
    assert.ok(fs.existsSync(reqFile), 'requirements.json should exist');

    const data = JSON.parse(fs.readFileSync(reqFile, 'utf-8'));
    assert.strictEqual(data.locked, true);
    assert.strictEqual(data.requirements.length, 2);
    assert.strictEqual(data.requirements[0].id, 'R01');
    assert.strictEqual(data.requirements[1].id, 'R02');
    assert.ok(data.checksum);
    assert.strictEqual(data.checksum, computeChecksum(data.requirements));
  });

  test('scaffold copies scripts including test-writer.ts, test-auditor.ts, and diff-rtm.ts', () => {
    scaffold(tmpDir);
    const verifyScript = path.join(tmpDir, '.ai-testing', 'scripts', 'verify.ts');
    const diffScript = path.join(tmpDir, '.ai-testing', 'scripts', 'diff-rtm.ts');
    const writerScript = path.join(tmpDir, '.ai-testing', 'scripts', 'test-writer.ts');
    const auditorScript = path.join(tmpDir, '.ai-testing', 'scripts', 'test-auditor.ts');
    assert.ok(fs.existsSync(verifyScript));
    assert.ok(fs.existsSync(diffScript));
    assert.ok(fs.existsSync(writerScript));
    assert.ok(fs.existsSync(auditorScript));
  });

  // ─── INTEGRITY & ANTI-TAMPER TESTS ─────────────────────

  test('Tamper requirements.json after lock → verify.ts must FAIL with checksum mismatch', () => {
    scaffold(tmpDir);

    const reqs = [{ id: 'R01', description: 'Original requirement', acceptanceCriteria: 'AC1' }];
    const validChecksum = computeChecksum(reqs);
    const reqFile = path.join(tmpDir, '.ai-testing', 'configs', 'requirements.json');

    const tamperedData = {
      version: '1.1.0',
      locked: true,
      lockedAt: new Date().toISOString(),
      checksum: validChecksum,
      requirements: [{ id: 'R01', description: 'TAMPERED REQUIREMENT', acceptanceCriteria: 'AC1' }],
    };
    fs.writeFileSync(reqFile, JSON.stringify(tamperedData, null, 2), 'utf-8');

    const verifyScript = path.join(__dirname, '..', 'templates', 'scripts', 'verify.ts');
    const result = spawnSync('npx', ['tsx', verifyScript], {
      cwd: tmpDir,
      encoding: 'utf-8',
      shell: true,
    });

    assert.strictEqual(result.status, 1, 'verify.ts should exit with code 1 when checksum mismatches');
    assert.ok(
      result.stdout.includes('checksum mismatch') || result.stderr.includes('checksum mismatch'),
      'Output should mention checksum mismatch'
    );
  });

  test('Test preservation: File .spec.ts already has content → test-writer preserves existing content & appends new test', () => {
    scaffold(tmpDir);

    const initialContent = `import { test, expect } from '@playwright/test';

test('Initial Test 1 — Existing feature test', async () => {
  const result = 100;
  expect(result).toBe(100);
});
`;
    const e2eDir = path.join(tmpDir, '.ai-testing', 'e2e');
    fs.mkdirSync(e2eDir, { recursive: true });
    const specFile = path.join(e2eDir, 'auth.spec.ts');
    fs.writeFileSync(specFile, initialContent, 'utf-8');

    const writerScript = path.join(__dirname, '..', 'templates', 'scripts', 'test-writer.ts');
    const newTestSnippet = `test('New Test 2 — Added feature test', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#email', 'test@example.com');
  expect(await page.title()).toBe('Login');
});`;
    const tempFile = path.join(tmpDir, 'new-test-snippet.ts');
    fs.writeFileSync(tempFile, newTestSnippet, 'utf-8');

    const result = spawnSync('npx', ['tsx', writerScript, '--feature', 'auth', '--file', tempFile], {
      cwd: tmpDir,
      encoding: 'utf-8',
      shell: true,
    });

    assert.strictEqual(result.status, 0, 'test-writer should succeed for valid test');

    const updatedContent = fs.readFileSync(specFile, 'utf-8');
    assert.ok(updatedContent.includes('Initial Test 1 — Existing feature test'), 'Old test must be preserved intact');
    assert.ok(updatedContent.includes('New Test 2 — Added feature test'), 'New test must be merged into file');
  });

  test('Mock vitest exit code 1 while .rtm.json has 100% ✅ → overallPass must FAIL (exit code 1)', () => {
    scaffold(tmpDir);

    const reqs = [{ id: 'R01', description: 'User login', acceptanceCriteria: 'Login works' }];
    const reqFile = path.join(tmpDir, '.ai-testing', 'configs', 'requirements.json');
    fs.writeFileSync(reqFile, JSON.stringify({
      version: '1.1.0',
      locked: true,
      lockedAt: new Date().toISOString(),
      checksum: computeChecksum(reqs),
      requirements: reqs,
    }, null, 2), 'utf-8');

    const rtmFile = path.join(tmpDir, '.ai-testing', 'reports', 'auth-latest.rtm.json');
    fs.writeFileSync(rtmFile, JSON.stringify({
      feature: 'auth',
      testedAt: new Date().toISOString(),
      requirements: [{
        id: 'R01',
        description: 'User login',
        status: '✅',
        notes: 'AI claims test passed',
      }],
    }, null, 2), 'utf-8');

    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'mock-app',
      devDependencies: { vitest: '^1.0.0' },
    }), 'utf-8');

    const binDir = path.join(tmpDir, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });

    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(binDir, 'vitest.cmd'), '@echo off\nexit /b 1\n');
    } else {
      const shPath = path.join(binDir, 'vitest');
      fs.writeFileSync(shPath, '#!/bin/sh\nexit 1\n');
      fs.chmodSync(shPath, 0o755);
    }

    const verifyScript = path.join(__dirname, '..', 'templates', 'scripts', 'verify.ts');
    const result = spawnSync('npx', ['tsx', verifyScript], {
      cwd: tmpDir,
      encoding: 'utf-8',
      shell: true,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      },
    });

    assert.strictEqual(
      result.status,
      1,
      'verify.ts must exit with code 1 when test runner fails, even if .rtm.json is 100% green'
    );
  });

  // ─── STATIC ANALYSIS & ANTI-DUMMY TEST SUITE ───────────

  test('Anti-Dummy: test-writer.ts REJECTS tautological test expect(true).toBe(true)', () => {
    scaffold(tmpDir);

    const writerScript = path.join(__dirname, '..', 'templates', 'scripts', 'test-writer.ts');
    const dummySnippet = `test('fake test', async () => {
  expect(true).toBe(true);
});`;
    const tempFile = path.join(tmpDir, 'dummy-test.ts');
    fs.writeFileSync(tempFile, dummySnippet, 'utf-8');

    const result = spawnSync('npx', ['tsx', writerScript, '--feature', 'auth', '--file', tempFile], {
      cwd: tmpDir,
      encoding: 'utf-8',
      shell: true,
    });

    assert.strictEqual(result.status, 1, 'test-writer should reject tautological test');
    assert.ok(
      result.stdout.includes('STATIC AUDIT REJECTED') || result.stderr.includes('STATIC AUDIT REJECTED'),
      'Should log static audit rejection'
    );
  });

  test('Anti-Dummy: test-writer.ts REJECTS empty test with no assertions', () => {
    scaffold(tmpDir);

    const writerScript = path.join(__dirname, '..', 'templates', 'scripts', 'test-writer.ts');
    const emptySnippet = `test('empty test', async () => {
  console.log('Doing nothing');
});`;
    const tempFile = path.join(tmpDir, 'empty-test.ts');
    fs.writeFileSync(tempFile, emptySnippet, 'utf-8');

    const result = spawnSync('npx', ['tsx', writerScript, '--feature', 'auth', '--file', tempFile], {
      cwd: tmpDir,
      encoding: 'utf-8',
      shell: true,
    });

    assert.strictEqual(result.status, 1, 'test-writer should reject test with zero assertions');
  });

  test('False Positive Prevention: expect(sum(1, 1)).toBe(2) MUST PASS static check', () => {
    scaffold(tmpDir);

    const writerScript = path.join(__dirname, '..', 'templates', 'scripts', 'test-writer.ts');
    const validMathSnippet = `test('calculates sum correctly', async () => {
  function sum(a, b) { return a + b; }
  expect(sum(1, 1)).toBe(2);
});`;
    const tempFile = path.join(tmpDir, 'valid-sum.ts');
    fs.writeFileSync(tempFile, validMathSnippet, 'utf-8');

    const result = spawnSync('npx', ['tsx', writerScript, '--feature', 'math', '--file', tempFile], {
      cwd: tmpDir,
      encoding: 'utf-8',
      shell: true,
    });

    assert.strictEqual(result.status, 0, 'expect(sum(1, 1)).toBe(2) must not be flagged as dummy');
  });

  test('False Positive Prevention: expect(response.status).toBe(200) MUST PASS static check', () => {
    scaffold(tmpDir);

    const writerScript = path.join(__dirname, '..', 'templates', 'scripts', 'test-writer.ts');
    const validApiSnippet = `test('checks response status', async () => {
  const response = { status: 200 };
  expect(response.status).toBe(200);
});`;
    const tempFile = path.join(tmpDir, 'valid-api.ts');
    fs.writeFileSync(tempFile, validApiSnippet, 'utf-8');

    const result = spawnSync('npx', ['tsx', writerScript, '--feature', 'api', '--file', tempFile], {
      cwd: tmpDir,
      encoding: 'utf-8',
      shell: true,
    });

    assert.strictEqual(result.status, 0, 'expect(response.status).toBe(200) must not be flagged as dummy');
  });

  test('Layer 2 Audit: verify.ts FAILS if test file in .ai-testing/e2e/ contains dummy test', () => {
    scaffold(tmpDir);

    // Setup valid requirements
    const reqs = [{ id: 'R01', description: 'User login', acceptanceCriteria: 'Login works' }];
    const reqFile = path.join(tmpDir, '.ai-testing', 'configs', 'requirements.json');
    fs.writeFileSync(reqFile, JSON.stringify({
      version: '1.1.0',
      locked: true,
      lockedAt: new Date().toISOString(),
      checksum: computeChecksum(reqs),
      requirements: reqs,
    }, null, 2), 'utf-8');

    // Create a dummy spec file directly in e2e
    const e2eDir = path.join(tmpDir, '.ai-testing', 'e2e');
    fs.mkdirSync(e2eDir, { recursive: true });
    const dummySpecFile = path.join(e2eDir, 'fake.spec.ts');
    fs.writeFileSync(dummySpecFile, `import { test, expect } from '@playwright/test';
test('bypassed dummy test', async () => {
  expect(1).toBe(1);
});
`, 'utf-8');

    // Run verify.ts
    const verifyScript = path.join(__dirname, '..', 'templates', 'scripts', 'verify.ts');
    const result = spawnSync('npx', ['tsx', verifyScript], {
      cwd: tmpDir,
      encoding: 'utf-8',
      shell: true,
    });

    assert.strictEqual(result.status, 1, 'verify.ts must fail Layer 2 audit when dummy tests exist');
    assert.ok(
      result.stdout.includes('STATIC AUDIT FAILED') || result.stderr.includes('STATIC AUDIT FAILED'),
      'Output should log Layer 2 static audit failure'
    );
  });
});
