# 08 — Product Roadmap: Data-Driven Insights

> **Status**: Planning
> **Origin**: Brainstorming session with Codex (GPT-5.3), Gemini (2.5), Claude (Sonnet)
> **Date**: 2026-03-02
> **Principle**: All features leverage **existing `focus_sessions` data** (13 fields) — no new collection mechanisms required.

---

## Phase Overview

| Phase | Theme | Timeline | Key Deliverables |
|-------|-------|----------|------------------|
| P1 | Data Foundation | 2-4 weeks | Enriched sessions, focus blocks, daily metrics v2 |
| P2 | New Visualizations | 2-3 weeks | Heatmap, Sankey, fragmentation index |
| P3 | AI Upgrade | 3-4 weeks | Weekly coach, natural language query, anomaly detection |
| P4 | Behavior Change | 4+ weeks | Goals, experiments, gamification |

---

## Phase 1: Data Foundation

Build the derived data layer that all subsequent features depend on.

### F1. Session Enrichment Pipeline

> **Priority**: P0 — every advanced feature depends on this
> **Table**: `session_enriched` (materialized view or async job)

Enrich raw `focus_sessions` with derived fields at sync time:

| Derived Field | Source | Logic |
|---------------|--------|-------|
| `domain` | `url` | Extract hostname via `new URL(url).hostname`, strip `www.` prefix |
| `normalized_title` | `window_title` | Regex strip timestamps, unread counts, trailing ` - AppName`, ` (N)` patterns |
| `project_key` | `document_path` | Extract 2nd-level directory: `/Users/x/work/gecko/foo.ts` → `gecko` |
| `role_type` | `bundle_id` + `category` | Rule-based: `creation` (IDE, editors, design), `communication` (Slack, Mail, Messages), `consumption` (browsers w/o doc_path, media), `system` (Finder, Settings) |
| `is_short_session` | `duration` | `duration < 15` (seconds) |
| `hour_bucket` | `start_time` + timezone | `Math.floor(localHour)` (0-23) |
| `weekday` | `start_time` + timezone | 0=Sunday, 1=Monday, ... 6=Saturday |
| `focus_block_id` | computed | See F2 below |

**Implementation approach**:
- Option A: Compute at query time as SQL expressions (zero migration cost, but slower queries)
- Option B: Run enrichment in the sync queue handler (`sync-queue.ts`) after INSERT, write to new columns or shadow table
- **Recommended**: Option A first (SQL views/CTEs), migrate to Option B when performance requires it

**Key files to modify**:
- `src/lib/session-queries.ts` — add enrichment CTEs to existing query functions
- `src/app/api/sync/route.ts` → `sync-queue.ts` — optional post-insert enrichment

---

### F2. Focus Blocks Aggregation

> **Priority**: P0
> **Table**: `focus_blocks`

Merge micro-sessions into meaningful work blocks. A block is a contiguous stretch of related activity.

**Schema**:
```sql
CREATE TABLE IF NOT EXISTS focus_blocks (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  date            TEXT NOT NULL,          -- YYYY-MM-DD (user timezone)
  block_start     REAL NOT NULL,          -- Unix timestamp
  block_end       REAL NOT NULL,          -- Unix timestamp
  total_duration  REAL NOT NULL,          -- seconds (sum of constituent sessions)
  gap_duration    REAL NOT NULL,          -- seconds (sum of gaps between sessions)
  session_count   INTEGER NOT NULL,
  interruptions   INTEGER NOT NULL DEFAULT 0,  -- switches to unrelated app then back
  dominant_app    TEXT NOT NULL,           -- app with most duration in block
  dominant_category TEXT,                  -- category of dominant app
  project_key     TEXT,                    -- from document_path extraction
  purity_score    REAL NOT NULL,          -- 0-1, (dominant_app_duration / total_duration)
  full_screen_ratio REAL NOT NULL,        -- proportion of time in full screen
  avg_tab_count   REAL,                   -- average tab_count during browser sessions
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_focus_blocks_user_date ON focus_blocks(user_id, date);
```

**Merge algorithm**:
1. Sort sessions by `start_time` for a given user+date
2. Start a new block with the first session
3. For each subsequent session:
   - If gap < **GAP_THRESHOLD** (default: 120s) AND (same category OR same project_key OR same app):
     - Extend current block
   - Else if gap < GAP_THRESHOLD AND different category AND duration < **SHORT_EXCURSION** (default: 30s):
     - Count as interruption, still extend block (the user briefly checked something)
   - Else:
     - Close current block, start new one
4. Compute aggregate fields for each block

**When to compute**: After each sync batch completes (in `sync-queue.ts` drain handler), recompute blocks for affected dates.

**Key files**:
- New: `src/services/focus-blocks.ts` — merge algorithm + CRUD
- Modify: `src/lib/sync-queue.ts` — trigger block recomputation after batch insert
- Migration: `drizzle/0008_focus_blocks.sql`

---

### F3. Daily Metrics v2

> **Priority**: P0
> **Table**: extend existing `daily_summaries` or new `daily_metrics` table

Unify all rule-based metrics in one place. Currently, stats are computed fresh per request in `daily-stats.ts`. Add new derived metrics alongside existing ones.

**New metrics to compute**:

| Metric | Formula | Value Proposition |
|--------|---------|-------------------|
| `fragmentation_index` | `(sessions_under_60s / total_sessions) * 0.4 + (1 - median_duration / max_duration) * 0.3 + (switches_per_hour / 30) * 0.3` | "Busy but unproductive" detector |
| `switch_cost_minutes` | `context_switches * RECOVERY_SECONDS / 60` where RECOVERY_SECONDS ≈ 20 (configurable) | "You lost X minutes to switching" |
| `time_to_return_p50` | Median time between leaving task A and returning to it | Recovery ability after interruption |
| `immersion_ratio` | `full_screen_duration / active_duration` | Deep engagement proxy |
| `tab_load_pressure` | `weighted_avg(tab_count, duration)` where weight = session duration | Cognitive load from browser tabs |
| `creation_ratio` | `(IDE + editor + doc_path_sessions) / total_active` | Production vs consumption balance |
| `hhi_concentration` | `SUM(app_share^2)` where app_share = app_duration / total | Herfindahl index for focus distribution |
| `task_inertia_minutes` | Time from first session of day to first focus_block with duration > 25min | "How long to get into flow" |

**Implementation**:
- Extend `src/services/daily-stats.ts` with new computation functions
- Store in `daily_summaries.stats_json` or add columns to `daily_summaries`
- Expose via `GET /api/daily/[date]` response alongside existing scores

**Key files**:
- Modify: `src/services/daily-stats.ts` — add metric computation functions
- Modify: `src/app/api/daily/[date]/route.ts` — include new metrics in response
- Modify: `src/components/daily/score-cards.tsx` — display new metrics

---

## Phase 2: New Visualizations

### F4. Weekly Heatmap (24h x 7 days)

> **Priority**: P1
> **Page**: New section on Overview (`/`) or new route `/weekly`

A grid where rows = hours (0-23), columns = weekdays (Mon-Sun). Each cell colored by a selectable metric (focus score, deep work minutes, switch rate, fragmentation).

**Data source**: Aggregate `focus_sessions` by `hour_bucket` x `weekday` over selected period.

**API**:
```
GET /api/stats/heatmap?period=4w&metric=focus_score
Response: { cells: [{ weekday: 1, hour: 10, value: 0.82 }, ...] }
```

**Implementation**:
- New: `src/app/api/stats/heatmap/route.ts` — SQL query grouping by hour+weekday
- New: `src/components/charts/weekly-heatmap.tsx` — grid component using CSS grid or SVG
- Color scale: sequential (green = good) or diverging (red/green around mean)
- Tooltip: show exact metric value + session count for that slot

---

### F5. App Transition Sankey Diagram

> **Priority**: P1
> **Page**: New section on Daily Review or standalone `/flows`

Visualize attention flow between apps. Left nodes = source apps, right nodes = destination apps, flow width = transition count or duration.

**Derived table**: `transition_edges`

```sql
-- Computed from sequential session pairs
CREATE TABLE IF NOT EXISTS transition_edges (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  date            TEXT NOT NULL,
  from_app        TEXT NOT NULL,
  to_app          TEXT NOT NULL,
  from_category   TEXT,
  to_category     TEXT,
  transition_count INTEGER NOT NULL DEFAULT 1,
  avg_gap_seconds REAL,
  hour_bucket     INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_transitions_user_date ON transition_edges(user_id, date);
```

**API**:
```
GET /api/stats/transitions?date=2026-03-01&min_count=2
Response: { edges: [{ from: "VS Code", to: "Chrome", count: 15, avgGap: 3.2 }, ...] }
```

**Implementation**:
- Library: `recharts` Sankey or `d3-sankey` (recharts doesn't have native Sankey — use `@nivo/sankey` or custom SVG with d3-sankey)
- New: `src/services/transitions.ts` — compute edges from session sequence
- New: `src/components/charts/transition-sankey.tsx`
- New: `src/app/api/stats/transitions/route.ts`
- Highlight "distraction loops": edges where to_app.category = consumption AND from_app.category = creation

---

### F6. Fragmentation & Session Distribution

> **Priority**: P1
> **Page**: Daily Review or Overview

Two visualizations:

**A. Fragmentation Index Card**: Single number (0-100) with trend sparkline. Red if > 70, green if < 30.
- Data: from `daily_metrics_v2` (F3)
- Component: `src/components/daily/fragmentation-card.tsx`

**B. Session Duration Histogram**: Bar chart showing distribution of session durations.
- Buckets: <15s, 15-60s, 1-5min, 5-15min, 15-30min, 30-60min, >60min
- Overlay: mark "short session" threshold and "deep work" threshold
- Component: `src/components/charts/duration-histogram.tsx`
- Data: direct query on `focus_sessions` with CASE WHEN bucketing

---

### F7. Calendar Heatmap (GitHub-style)

> **Priority**: P2
> **Page**: Overview page, replacing or supplementing the daily bar chart

Full-year (or 3-month) calendar strip where each day is a colored square. Color = overall score, deep work hours, or fragmentation.

**Implementation**:
- Library: Custom SVG (simple grid, 7 rows × N weeks)
- Data: `GET /api/stats/calendar?months=3&metric=ai_score`
- Query: aggregate daily_summaries or daily_metrics for color values
- Interaction: click a day → navigate to `/daily/[date]`
- Component: `src/components/charts/calendar-heatmap.tsx`

---

### F8. Category Streamgraph

> **Priority**: P2
> **Page**: Daily Review, below Gantt chart

A stacked area chart (streamgraph) showing how category proportions shift throughout the day. X-axis = time of day (30-min buckets), Y-axis = duration per category.

**Implementation**:
- Data: aggregate `focus_sessions` by 30-min bucket × category
- API: `GET /api/daily/[date]/stream?bucket=30m`
- Library: recharts AreaChart with stacked areas
- Component: `src/components/daily/category-stream.tsx`

---

### F9. App Treemap

> **Priority**: P2
> **Page**: Overview or Apps page

Hierarchical treemap: top level = category, nested = app, area = duration.

**Implementation**:
- Library: recharts Treemap or `@nivo/treemap`
- Data: existing `GET /api/apps` with category mappings
- Component: `src/components/charts/app-treemap.tsx`

---

## Phase 3: AI Upgrade

### F10. Weekly Coach

> **Priority**: P1
> **Scope**: New page `/weekly/[week]` or section in Overview

AI-generated weekly review with strategic-level advice (vs daily tactical review).

**Prompt structure**:
1. Aggregate 7 days of `daily_metrics_v2`
2. Compare with previous week (delta for each metric)
3. Include focus_blocks summary (total deep work, avg block length)
4. Include top transition patterns (distraction loops)
5. Ask LLM for: 3 high-leverage suggestions, week-over-week narrative, recommended experiments

**Schema addition**:
```sql
CREATE TABLE IF NOT EXISTS weekly_summaries (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  week_start      TEXT NOT NULL,     -- YYYY-MM-DD (Monday)
  ai_result_json  TEXT,
  ai_model        TEXT,
  ai_generated_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, week_start)
);
```

**API**:
```
GET  /api/weekly/[week]          — fetch cached weekly summary + computed stats
POST /api/weekly/[week]/analyze  — generate AI weekly review
```

**Key files**:
- New: `src/services/weekly-stats.ts` — aggregate daily metrics for a week
- New: `src/app/api/weekly/[week]/route.ts`
- New: `src/app/api/weekly/[week]/analyze/route.ts`
- New: `src/app/weekly/[week]/page.tsx`
- New: `src/components/weekly/weekly-review-client.tsx`

---

### F11. Natural Language Query (Chat with Your Data)

> **Priority**: P2
> **Page**: New `/chat` route or floating panel

Users ask questions like "How much time did I spend in Figma last week?" or "What was my most productive day this month?"

**Architecture**:
1. User sends question
2. Backend builds context from pre-aggregated data (daily_metrics, app_daily_rollup, focus_blocks)
3. LLM generates answer with data citations
4. **No direct SQL generation** — use structured API queries to avoid injection risks

**API**:
```
POST /api/chat
Body: { question: "上周我在 VS Code 花了多久?" }
Response: { answer: "上周你在 VS Code 花了 12 小时 35 分钟，其中深度工作块占 8 小时...", sources: [...] }
```

**Implementation**:
- New: `src/services/chat-context.ts` — build relevant data context from question keywords
- New: `src/app/api/chat/route.ts`
- New: `src/app/chat/page.tsx`
- New: `src/components/chat/chat-panel.tsx`

---

### F12. Anomaly Detection

> **Priority**: P2
> **Table**: `anomaly_events`

Detect unusual days/patterns and surface them proactively.

**Schema**:
```sql
CREATE TABLE IF NOT EXISTS anomaly_events (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  date            TEXT NOT NULL,
  metric          TEXT NOT NULL,       -- e.g. 'switch_rate', 'deep_work_minutes'
  expected_value  REAL NOT NULL,       -- rolling 14-day mean
  actual_value    REAL NOT NULL,
  z_score         REAL NOT NULL,       -- (actual - mean) / stddev
  severity        TEXT NOT NULL,       -- 'info' | 'warning' | 'critical'
  direction       TEXT NOT NULL,       -- 'above' | 'below'
  acknowledged    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_anomalies_user_date ON anomaly_events(user_id, date);
```

**Detection logic**:
1. Maintain rolling 14-day mean + stddev per metric per user (computed from `daily_metrics`)
2. After each day's metrics are finalized, compare against baseline
3. Flag if |z_score| > 2.0 (warning) or > 3.0 (critical)
4. Store anomaly event; surface in Dashboard as notification badge

**Implementation**:
- New: `src/services/anomaly-detection.ts` — baseline computation + event detection
- New: `src/components/layout/anomaly-badge.tsx` — notification indicator
- Modify: `GET /api/daily/[date]` — include relevant anomalies in response

---

### F13. AI Auto-Tagging

> **Priority**: P2

Reduce manual category/tag management. Suggest categories and tags for uncategorized apps.

**Logic** (rule-based first, LLM fallback):
1. Bundle ID prefix mapping: `com.apple.dt.*` → Development, `com.google.Chrome` → Browser
2. Window title keyword matching: contains "Figma" → Design, contains "Slack" → Communication
3. URL domain classification: `github.com` → Development, `twitter.com` → Social
4. For unresolved: batch uncategorized apps, send to LLM with context, get suggestions
5. Present suggestions in App Management page with accept/reject UI

**Implementation**:
- New: `src/services/auto-tagger.ts` — rule engine + LLM fallback
- Modify: `src/app/apps/page.tsx` — show suggestion badges
- New: `src/app/api/apps/suggest-tags/route.ts`

---

## Phase 4: Behavior Change

### F14. Context Switch Cost Dashboard

> **Priority**: P1
> **Page**: Daily Review or dedicated section

The single most impactful insight (all 3 agents agreed): quantify the cost of context switching.

**Visualization**:
- Card: "You lost **47 minutes** to context switching today"
- Breakdown: top 5 "distraction sources" (apps that interrupt deep work)
- Chart: Time-to-Return distribution (how long to get back on task after interruption)

**Data**:
- From `transition_edges` (F5): identify creation→consumption→creation patterns
- Recovery time = gap between leaving focus_block and next focus_block start
- Switch cost = count × estimated recovery time (default 20s, or personalized from data)

**Implementation**:
- New: `src/components/daily/switch-cost-card.tsx`
- Modify: `src/services/daily-stats.ts` — add switch cost computation
- Modify: `src/components/daily/daily-review-client.tsx` — integrate card

---

### F15. Goal Setting & Tracking

> **Priority**: P2

Let users set targets and track progress.

**Schema**:
```sql
CREATE TABLE IF NOT EXISTS user_goals (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  metric          TEXT NOT NULL,       -- 'deep_work_minutes', 'switch_rate', 'fragmentation'
  target_value    REAL NOT NULL,
  direction       TEXT NOT NULL,       -- 'above' | 'below' (above = good for deep_work, below = good for switch_rate)
  period          TEXT NOT NULL,       -- 'daily' | 'weekly' | 'monthly'
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Features**:
- Settings page section for goal management
- Progress bar on Overview page: "Deep Work: 2h15m / 4h target"
- Weekly goal trajectory chart: cumulative progress line vs target pace line
- AI references goals in daily/weekly reviews

**Implementation**:
- Migration: `drizzle/00XX_user_goals.sql`
- New: `src/app/api/goals/route.ts` — CRUD
- New: `src/components/goals/goal-progress.tsx`
- Modify: Overview page to show goal progress cards

---

### F16. Behavior Experiments

> **Priority**: P3

AI suggests small experiments; system automatically evaluates results.

**Flow**:
1. AI identifies opportunity: "Your switch rate spikes 2-4 PM"
2. Suggests experiment: "Try closing Slack 2-4 PM for 5 days"
3. User accepts → system records experiment parameters
4. After experiment period, system compares target metric (switch_rate during 2-4 PM) before vs during
5. AI generates result narrative: "Switch rate dropped 35%, saving ~22 min/day"

**Schema**:
```sql
CREATE TABLE IF NOT EXISTS experiments (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  title           TEXT NOT NULL,
  hypothesis      TEXT NOT NULL,
  metric          TEXT NOT NULL,
  target_segment  TEXT,               -- JSON: { "hour_start": 14, "hour_end": 16 }
  baseline_value  REAL NOT NULL,      -- metric value before experiment
  start_date      TEXT NOT NULL,
  end_date        TEXT,
  status          TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'completed' | 'cancelled'
  result_value    REAL,
  result_json     TEXT,               -- AI-generated analysis
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Implementation**:
- New: `src/services/experiments.ts` — create, evaluate, analyze
- New: `src/app/experiments/page.tsx`
- New: `src/app/api/experiments/route.ts`

---

### F17. Gamification: Streaks & Achievements

> **Priority**: P3

**Streak system**:
- Track consecutive days meeting a threshold (e.g., deep work > 2h, fragmentation < 40)
- Display current streak + longest streak on Overview
- Visual: flame icon with count

**Achievement badges** (examples):
| Badge | Condition |
|-------|-----------|
| Flow Master | Single focus block > 2 hours |
| Deep Diver | 5 consecutive days with > 3h deep work |
| Zen Mode | Full day with switch rate < 5/hour |
| Comeback Kid | Time-to-return improved 20% week over week |
| Night Owl / Early Bird | Consistent work start time for 2 weeks |

**Schema**:
```sql
CREATE TABLE IF NOT EXISTS achievements (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  badge_type      TEXT NOT NULL,
  achieved_at     TEXT NOT NULL,
  metadata_json   TEXT,              -- context about achievement
  UNIQUE(user_id, badge_type, achieved_at)
);

CREATE TABLE IF NOT EXISTS streaks (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  metric          TEXT NOT NULL,
  current_count   INTEGER NOT NULL DEFAULT 0,
  longest_count   INTEGER NOT NULL DEFAULT 0,
  last_achieved   TEXT,
  UNIQUE(user_id, metric)
);
```

**Implementation**:
- New: `src/services/gamification.ts` — streak tracking + achievement evaluation
- New: `src/components/gamification/streak-badge.tsx`
- New: `src/components/gamification/achievement-list.tsx`
- Trigger: evaluate after daily_metrics are computed

---

### F18. Project Lens

> **Priority**: P2

Auto-detect projects from `document_path` and show project-level analytics.

**Derived table**: `project_daily_rollup`
```sql
CREATE TABLE IF NOT EXISTS project_daily_rollup (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  date            TEXT NOT NULL,
  project_key     TEXT NOT NULL,       -- extracted from document_path
  total_duration  REAL NOT NULL,
  deep_work_duration REAL NOT NULL,
  session_count   INTEGER NOT NULL,
  block_count     INTEGER NOT NULL,
  avg_block_purity REAL,
  switch_rate     REAL,
  UNIQUE(user_id, date, project_key)
);
```

**Project detection rules**:
1. `document_path` → extract directory at depth 2-3 (e.g., `~/work/gecko/...` → `gecko`)
2. `url` → extract repo name from GitHub/GitLab URLs
3. `window_title` → match patterns like `project-name — IDE`
4. Allow user override: map project_key → display name

**Page**: New `/projects` route or section in Overview
- Project list with time invested per project
- Per-project focus quality metrics
- Trend chart: project time allocation over weeks

---

### F19. Health & Wellbeing Alerts

> **Priority**: P3

Privacy-friendly, derived entirely from existing data.

| Alert | Trigger | Action |
|-------|---------|--------|
| Continuous work | Active duration > 90min with no gap > 5min | Dashboard banner: "Take a break" |
| Late night | Sessions after 23:00 (user timezone) | Next-day review note |
| Cognitive overload | tab_count > 25 + switch_rate > 20/hour + fragmentation > 70 | Dashboard warning badge |
| Weekend creep | Weekend screen time > 50% of weekday average | Weekly review callout |

**Implementation**:
- New: `src/services/health-alerts.ts` — evaluate conditions against daily_metrics
- Modify: `src/components/layout/sidebar.tsx` — show alert indicators
- Include alerts in AI prompt context for daily/weekly reviews

---

### F20. External Integrations (Future)

> **Priority**: P3 — design API, implement incrementally

| Integration | Mechanism | Value |
|-------------|-----------|-------|
| **Calendar** (Google/Apple) | Import events via API, correlate with focus_sessions by time overlap | "Planned vs actual" analysis |
| **Git** (GitHub/GitLab) | Match commit timestamps with focus_blocks on same project | Validate "coding time" with actual output |
| **Todo** (Linear/Todoist) | Match task names with window_title/url keywords | Task-level time tracking |
| **Focus mode** (macOS) | Trigger macOS Focus mode during predicted high-productivity windows | From diagnosis to intervention |

**Design principle**: All integrations read-only first. Gecko observes and correlates, never blocks or restricts (that's the user's choice).

---

## Data Architecture Summary

```
Raw Layer                    Enriched Layer              Aggregate Layer
─────────────               ──────────────              ───────────────
focus_sessions ──────────►  session_enriched  ────────► daily_metrics_v2
  (13 fields)                 (+domain,                   (20+ metrics)
                               normalized_title,
                               project_key,             focus_blocks
                               role_type,                 (work block level)
                               hour_bucket,
                               weekday)                 transition_edges
                                                          (app flow network)
categories ──────────────►
tags ────────────────────►  project_clusters            app_daily_rollup
app_notes ───────────────►                              project_daily_rollup
                                                        hourly_patterns
                                                        weekly_summaries
                                                        anomaly_events
                                                        streaks / achievements
```

---

## Migration Plan

| Migration | Table | Phase | Depends On |
|-----------|-------|-------|------------|
| `0008` | `focus_blocks` | P1 | — |
| `0009` | `transition_edges` | P2 | — |
| `0010` | `weekly_summaries` | P3 | — |
| `0011` | `anomaly_events` | P3 | — |
| `0012` | `user_goals` | P4 | — |
| `0013` | `experiments` | P4 | — |
| `0014` | `achievements` + `streaks` | P4 | — |
| `0015` | `project_daily_rollup` | P2 | — |

Note: `session_enriched`, `daily_metrics_v2`, `app_daily_rollup`, and `hourly_patterns` are computed views/CTEs — no migration needed unless we materialize them for performance.

---

## Feature Dependency Graph

```
F1 (session_enriched) ───► F2 (focus_blocks) ───► F3 (daily_metrics_v2)
         │                        │                        │
         │                        ▼                        ▼
         │                 F14 (switch cost)         F4 (heatmap)
         │                 F18 (project lens)        F6 (fragmentation)
         │                                           F7 (calendar)
         ▼                                           F12 (anomaly)
  F5 (Sankey) ◄── F5.table (transition_edges)       F15 (goals)
  F13 (auto-tag)                                     F17 (gamification)
                                                     F19 (health)
  F10 (weekly coach) ◄── F3 + F2
  F11 (chat) ◄── F3 + F2 + F5
  F16 (experiments) ◄── F3 + F12
```

Critical path: **F1 → F2 → F3** must be built first. Everything else branches from there.
