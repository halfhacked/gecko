# Four-Layer Testing Improvement Plan

> Execution plan to align Gecko's test infrastructure with the four-layer testing standard.

## Current Status

| Layer | Standard | Status | Gap |
|-------|----------|--------|-----|
| L1: Unit Tests | 90%+ coverage, pre-commit gate | **PASS** | — |
| L2: Lint | Strict mode, zero tolerance | **PARTIAL** | ESLint not strict; no `--max-warnings 0` |
| L3: API E2E | 100% REST API coverage, pre-push gate | **PARTIAL** | 9/27 routes uncovered; pre-push silently skips E2E |
| L4: BDD E2E | Playwright browser tests for core flows | **MISSING** | No Playwright; no browser tests at all |

## Phase 1 — Fix Bugs + Lint Upgrade (Critical)

### 1.1 Fix pre-push E2E silent skip

**Problem**: `.husky/pre-push` runs `bun test src/__tests__/e2e/` without `RUN_E2E=true`,
so all E2E tests are silently skipped by `describe.skipIf(!process.env.RUN_E2E)`.

**Fix**:
- Add `RUN_E2E=true` to the pre-push E2E command
- Add E2E dev server auto-start/stop logic to the hook
- Add port conflict detection (kill stale processes before starting)

### 1.2 ESLint → strictTypeChecked

**Problem**: ESLint uses `tseslint.configs.recommended` (mid-tier). Missing safety rules like
`no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-return`, `no-unsafe-member-access`.

**Fix**:
- `eslint.config.mjs`: switch to `tseslint.configs.strictTypeChecked`
- Add `parserOptions.projectService: true` for type-aware linting
- `package.json`: change lint script to `eslint --max-warnings 0`
- Fix all new violations (expect ~20-50 issues, mostly `any` usage)

### 1.3 SwiftLint → strict mode

**Problem**: `swiftlint lint` treats warnings as non-blocking. Pre-push hook counts JSON
violations but may miss warning-level issues.

**Fix**:
- Pre-push hook: change to `swiftlint lint --strict`
- Fix any new violations that surface

## Phase 2 — API E2E Completion

### 2.1 Port standardization

| Purpose | Current | Target |
|---------|---------|--------|
| Dev server | 7028 | 7028 (unchanged) |
| API E2E server | 10728 | 17028 |
| BDD E2E server | N/A | 27028 |

Update: `dev:e2e` script, all E2E test files, pre-push hook.

### 2.2 E2E server auto-management script

Create `scripts/e2e-server.sh`:
- Check target port for conflicts, kill stale processes
- Start E2E dev server in background
- Health-check loop (poll `/api/live` until ready, 30s timeout)
- Trap EXIT to ensure cleanup

### 2.3 Fill uncovered API routes

**High priority** (security/public-facing):

| E2E Test File | Routes Covered |
|---------------|---------------|
| `keys-roundtrip.test.ts` | `GET/POST /api/keys`, `PATCH/DELETE /api/keys/[id]` |
| `public-api.test.ts` | `GET /api/v1/snapshot` (with API key auth) |

**Medium priority** (core data):

| E2E Test File | Routes Covered |
|---------------|---------------|
| `stats.test.ts` | `GET /api/stats`, `GET /api/stats/timeline` |
| `timezone-settings.test.ts` | `GET/PUT /api/settings/timezone` |
| `app-notes.test.ts` | `GET/PUT/DELETE /api/apps/notes`, `GET /api/apps` |
| `sync-status.test.ts` | `GET /api/sync/status` |

**Excluded** (acceptable gaps):
- `/api/auth/[...nextauth]` — third-party NextAuth, tested by library
- `/api/live` — trivial probe, used as health check in test setup

**Target: 25/27 routes covered (93%).**

### 2.4 Update pre-push hook

Integrate `scripts/e2e-server.sh` into `.husky/pre-push`:
- Auto-start E2E server before tests
- Run with `RUN_E2E=true`
- Auto-stop server after tests

## Phase 3 — BDD E2E (Playwright)

### 3.1 Install and configure Playwright

- `bun add -d @playwright/test`
- `bunx playwright install chromium`
- Create `playwright.config.ts` with:
  - `testDir: './src/__tests__/bdd'`
  - `baseURL: 'http://localhost:27028'`
  - `webServer` config for auto-start on port 27028
  - Screenshot on failure

### 3.2 Core user flow BDD tests

| Test File | User Flow |
|-----------|-----------|
| `dashboard.spec.ts` | Load dashboard → verify stats cards → switch date range |
| `daily-review.spec.ts` | Navigate to daily review → see timeline → trigger AI analysis |
| `settings.spec.ts` | Open settings → change timezone → save → verify persisted |
| `categories.spec.ts` | Create category → add mapping → verify app categorized |
| `backy.spec.ts` | Configure Backy → trigger backup → verify success state |

### 3.3 Update pre-push hook

Add BDD E2E stage after API E2E:
```
Stage 3a: API E2E (port 17028)
Stage 3b: BDD E2E (port 27028, via Playwright)
```

### 3.4 Add npm scripts

```json
"test:bdd": "bunx playwright test",
"dev:bdd": "E2E_SKIP_AUTH=true vinext dev --port 27028"
```

## Execution Order

```
Phase 1.1  Fix pre-push E2E skip bug          ← CRITICAL BUG
Phase 1.2  ESLint strictTypeChecked            ← Lint quality gate
Phase 1.3  SwiftLint --strict                  ← Lint quality gate
Phase 2.1  Port standardization                ← Foundation for Phase 2-3
Phase 2.2  E2E server auto-management          ← Pre-push reliability
Phase 2.3  Fill uncovered API E2E tests        ← API coverage 67%→93%
Phase 2.4  Update pre-push hook                ← Wire it all together
Phase 3.1  Install Playwright                  ← BDD foundation
Phase 3.2  Write BDD tests                     ← Core flow coverage
Phase 3.3  Update pre-push + scripts           ← Final integration
```
