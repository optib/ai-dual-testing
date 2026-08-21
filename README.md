# 🧪 AI Dual-Track Testing

> One-command verification skill for Vibe Code projects.

## Install

```bash
npx ai-dual-testing
```

**That's it.** Your AI tool now knows how to verify code.

## Lock Requirements Upfront

To prevent scope drift, lock requirements with cryptographic SHA-256 integrity check before coding:

```bash
npx ai-dual-testing lock "1. User can register with email\n2. User can login"
# Or from a PRD file:
npx ai-dual-testing lock -f PRD.md
```

## Usage

After install, tell your AI:

```
verify
verify feature login
kiểm tra
check coverage
```

The AI will:
- Lock / verify baseline requirements with SHA-256 checksum
- Safely generate & merge Playwright / Vitest test cases via `test-writer.ts` (anti-dummy test filter)
- Execute tests capturing real exit codes (no error swallowing)
- Generate timestamped RTM history and diff regressions
- Capture screenshots for UI evidence
- **NOT auto-fix** — you decide what to fix

## Files created

```
.ai-testing/
├── scripts/
│   ├── verify.ts           ← Main verification runner (exit code & static audit enforced)
│   ├── test-writer.ts      ← Safe test creator & merger (anti-dummy test filter)
│   ├── test-auditor.ts     ← Static analysis engine (detects tautological/fake tests)
│   ├── master-rtm.ts       ← Timestamped RTM aggregator
│   ├── diff-rtm.ts         ← RTM historical regression & diff auditor
│   └── coverage-report.ts  ← Dual coverage check
├── configs/
│   ├── requirements.json   ← Baseline requirements (SHA-256 locked)
│   ├── thresholds.json     ← Coverage thresholds & static analysis rules
│   └── playwright.config.ts← Playwright E2E configuration
├── reports/
│   ├── screenshots/        ← Playwright screenshots
│   └── .gitkeep
└── e2e/                    ← Playwright test dir
```

## Supported AI Tools

| Tool | Rule file |
|------|-----------|
| Cursor | `.cursorrules` (appended) |
| Antigravity | `.agents/skills/ai-testing/SKILL.md` |
| Claude Code | `CLAUDE.md` (appended) |
| Windsurf | `.windsurfrules` (appended) |
| None detected | `AGENTS.md` (created) |

## Known Limitations

> [!WARNING]
> Please be aware of the following structural limitations in the current version:
>
> 1. **Filesystem Write Bypass**: The AI Agent operates with your workspace permissions. If an agent deliberately bypasses the `test-writer.ts` script and directly calls filesystem tools on `.spec.ts` files, this cannot be blocked at the OS layer without a containerized sandbox.
> 2. **Context Sharing (No Subagent Sandbox)**: Verification currently executes within the same chat session/context as the coding agent. Complete multi-agent role isolation (separating developer and QA into separate isolated processes) is planned for future versions.
> 3. **Self-Referential / Circular Assertions**: Static analysis detects literal tautologies (e.g. `expect(true).toBe(true)`, `expect(1).toBe(1)`, missing assertions, and hollow Playwright tests), but **cannot statically detect circular/self-referential assertions** (such as `expect(fn()).toBe(fn())` calling the subject under test on both sides).

## License

MIT
