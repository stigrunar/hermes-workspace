# The Matrix operator cockpit UX backlog

Status: UX backlog / operator-flow map
Owner: DollyDesign
Task: t_ce67890d
Created: 2026-05-10
Scope: The Matrix / `/swarm2` cockpit, mobile operator flow, worker-control visibility, high-value next-action radar, and Kanban board/task drilldown polish.

## 0. Grounding: current live/repo behavior

Evidence checked in the live checkout on branch `stig/the-matrix`:

- `README.md` states the Stig/Matrix branch brands the Swarm control surface as The Matrix, keeps stable worker ids such as `swarm2`, keeps the compatibility board slug `mission-control`, prefers that named board when available, falls back safely, and keeps board selection + task drill-down read-only for parity with shared Hermes Kanban.
- `/swarm2` is the Matrix route and sets the document title to `The Matrix — Hermes Workspace` via `src/lib/matrix-branding.ts`.
- Browser probe of `http://127.0.0.1:3000/swarm2` confirmed the running app is password protected before cockpit access. Unauthenticated probes to `/api/swarm-kanban`, `/api/crew-status`, `/api/swarm-runtime`, and `/api/swarm-missions` returned 401.
- `src/screens/swarm2/swarm2-screen.tsx` currently exposes four main modes from the orchestrator card: `Control`, `Board`, `Inbox`, and `Runtime`.
- `src/screens/swarm2/swarm2-orchestrator-card.tsx` already contains a compact main-agent hub, router CTA, budget cockpit, active-swarm/office toggle, state lenses (`All`, `Run`, `Review`, `Blocked`, `Ready`), and active-agent cards.
- `src/screens/swarm2/matrix-budget-cockpit.tsx` already exposes advisory context, spend, provider-auth, room count, auth alerts, focus, runtime model, and an explicit next enforcement hook (`/api/swarm-dispatch`).
- `src/screens/swarm2/swarm2-kanban-board.tsx` currently shows all/named board selection, source-board badges, lane counts, read-only drilldown, done-audit warnings, task body/result/comments/recent-runs/workspace detail, and a `Read-only drill-down` badge.
- `src/screens/swarm2/swarm2-reports-view.tsx` already builds Inbox lanes for `Needs review`, `Blocked / needs input`, and `Ready handoffs`, plus worker cards/list views from mission and runtime telemetry.
- `docs/matrix-kanban-write-dispatch-controls-spec.md` defines the safe mutation boundary: Matrix can prepare, route, block, and request dispatch, but workers still own `done`, true `running`, evidence, and completion receipts.
- Existing screenshots reviewed: `public/screenshots/mission-control-v3.png` and `public/screenshots/mobile-dashboard-v3.png`. They show a strong mission/status foundation, but they still lean toward passive state display and broad controls rather than a crisp next-action cockpit.

Implication: The Matrix has enough read-only aggregate behavior to become useful, but the next UX work should not start with prettier cards. It should define operator decisions, proof/receipt states, and mobile triage before broader write controls are exposed.

## 1. Product north star

The cockpit should answer, within 5 seconds:

1. What needs Stig/the operator now?
2. What is running normally?
3. What is stuck, stale, blocked, or unsafe to trust?
4. Which task/worker/report proves that state?
5. What is the safest next action?

Design principle: The Matrix is an operator cockpit, not a second completion engine. It can surface intent and request actions, but it must not imply `running`, `i arbeid`, `review`, or `done` unless canonical evidence exists.

## 2. Operator flow map

### Flow A — Mobile triage / morning check

Goal: Open The Matrix on a phone and know where attention goes first.

1. Operator opens `/swarm2`.
2. Top summary shows system state: `Action needed`, `Degraded`, or `Clear`.
3. Next-action radar ranks urgent items:
   - blocked / needs input
   - review-ready handoffs
   - stale running tasks
   - failed dispatch / auth / provider warnings
   - done slices with open follow-up
4. Operator taps the first item.
5. The cockpit opens the relevant task/worker/report detail with the reason and safe actions.
6. Operator either responds, routes, requests dispatch, or marks that no action is needed.

Failure mode to avoid: the operator has to inspect Board, Inbox, Runtime, and raw logs manually to discover the same answer.

### Flow B — Worker-control visibility

Goal: Understand a worker without opening terminal output first.

1. Operator sees worker status in Control mode.
2. Worker card states:
   - canonical assignment/task id if any
   - current activity label
   - last useful signal
   - state age
   - evidence source (`runtime`, `mission`, `kanban`, `fallback`)
3. Operator opens worker detail.
4. Detail shows current task, accepted scope fields if task-bound, last run/checkpoint, artifacts/previews, and available safe actions.
5. Unsafe actions require reason and produce a receipt/comment.

Failure mode to avoid: `Ready` or `live` looks healthy while a task is actually unclaimed, stale, or missing acceptance.

### Flow C — Next-action radar

Goal: Convert raw board/runtime counts into an attention queue.

1. The Matrix computes a ranked list from Kanban + mission + runtime + budget/auth signals.
2. Each radar item has a why-label, severity, evidence source, and target route.
3. Operator clicks an item and lands in context, not just the generic tab.
4. After action, the item changes to `queued`, `resolved`, `waiting for canonical claim`, or `still blocked`.

Failure mode to avoid: counts are visible, but the operator still has to decide what matters.

### Flow D — Board/task drilldown polish

Goal: Make read-only Kanban detail usable enough before write controls.

1. Operator opens Board.
2. Board defaults to attention-sorted view on mobile and lane view on desktop.
3. Task cards show the minimum proof state:
   - source board
   - lane/status
   - assignee/profile
   - acceptance present/missing
   - run evidence present/missing
   - open child/follow-up count
4. Task drilldown presents body, comments, result/handoff, recent runs, workspace, children/dependencies, done-audit warnings, and clear next action.
5. If write controls are not yet safe, the UI says exactly why and links to the control spec boundary.

Failure mode to avoid: drilldown becomes a raw data dump with no operator decision.

### Flow E — Safe route/dispatch request

Goal: Allow the operator to ask for work to be dispatched without bypassing worker lifecycle.

1. Operator selects a ready task.
2. Matrix validates acceptance fields and assignee/worker match.
3. If fields are missing, it shows a conflict banner with exact missing fields.
4. If valid, operator chooses `Request dispatch`, adds a reason, and receives a dispatch receipt.
5. UI shows `Dispatch queued` until canonical claim/run evidence appears.
6. Only then can the UI show `running`.

Failure mode to avoid: Matrix optimism labels work as underway before the specialist has accepted and the dispatcher has claimed.

## 3. Prioritized UX backlog

Priority definitions:

- P0: Required before The Matrix can be trusted as a cockpit.
- P1: Required before bounded write/control affordances feel safe.
- P2: Polish and scale work after the core operating model is clear.

### P0.1 — Add root design contract for The Matrix cockpit

Problem:
The repo currently has no root `DESIGN.md`, while The Matrix is an active UI/product surface with multiple agents likely to touch it.

Slice:
Create/maintain a root design contract that defines The Matrix information hierarchy, state semantics, density, mobile rules, and evidence boundaries.

Acceptance criteria:
- Root `DESIGN.md` exists and names The Matrix cockpit scope.
- It defines the allowed state vocabulary: `assigned`, `accepted`, `queued`, `claimed/running`, `blocked`, `needs review`, `done via worker`, `done with follow-up`, and `unknown`.
- It states that `done` and true `running` require canonical evidence.
- It includes mobile minimums and focus/keyboard/accessibility expectations.
- Future UI reviews can cite it directly.

### P0.2 — Next-action radar above modes

Problem:
The current Matrix modes expose useful surfaces, but the operator still has to choose where to look. Counts are not the same as attention.

Slice:
Add a compact radar strip/panel above or inside the orchestrator hub. It ranks the top 3-5 operator actions across Inbox, Board, Runtime, budget/auth, and done-audit signals.

Acceptance criteria:
- Shows severity, label, why, source, and target for each item.
- Includes at least these item types: `needs_input`, `review_ready`, `stale_running`, `failed_or_degraded_dispatch`, `done_with_open_followup`, `done_missing_evidence`, `auth_or_provider_warning`.
- Empty state says `No operator action needed` and still shows last refreshed time.
- Tapping/clicking an item opens the relevant Board detail, Inbox row, worker card, Runtime terminal, or budget/provider detail.
- Mobile: radar appears above worker grids and uses touch targets >= 44px.
- Does not mark anything resolved unless canonical evidence changed.

### P0.3 — Canonical state/explanation labels on worker and task cards

Problem:
Labels such as `Ready`, `live`, or `running` can be ambiguous. Operators need to know whether a state comes from Kanban, runtime, mission telemetry, or fallback inference.

Slice:
Add a small but explicit state explanation line wherever worker/task status is shown.

Acceptance criteria:
- Worker cards show state + state age + evidence source.
- Task cards show `acceptance missing/present`, `run evidence missing/present`, and `open follow-up` where applicable.
- `Ready` is not used alone; it is rendered as `Ready for dispatch`, `Worker idle`, or `Ready handoff` depending on source.
- Unknown/fallback data is visually muted and labeled as such.
- State colors are semantic and consistent: green = healthy/proven, amber = queued/waiting/follow-up, red = blocked/failed/evidence missing, blue/violet = review/route.

### P0.4 — Board/task drilldown decision header

Problem:
The current read-only drilldown exposes data, but it should open with the operational answer: what this task means and what can happen next.

Slice:
Add a task-detail header block that summarizes status, trust/evidence, owner, acceptance state, blockers, follow-up, and next safe action.

Acceptance criteria:
- Header appears before body/comments/runs.
- Header includes one of: `No action`, `Needs acceptance`, `Ready to route`, `Dispatch queued`, `Claimed/running`, `Blocked`, `Needs review`, `Done via worker`, `Done but follow-up open`, `Evidence missing`.
- If specialist acceptance is missing, the header lists the exact missing fields.
- If done-audit warnings exist, they are elevated in the header, not buried below stats.
- It never offers direct `done` or direct `running` actions.
- Mobile: header is sticky or repeated as a compact bottom action summary inside the modal/drawer.

### P0.5 — Mobile-first cockpit ordering

Problem:
Current responsive behavior mainly stacks desktop cards. On mobile, the operator needs triage before topology, dense analytics, and full lane boards.

Slice:
Define and implement a mobile order for `/swarm2`:
1. global state / freshness
2. next-action radar
3. selected critical item detail
4. compact worker lanes
5. board/inbox shortcuts
6. budget/auth summary
7. full topology/lane views only on demand

Acceptance criteria:
- At 390px width, the first viewport answers `Action needed?` and `What changed?`.
- The router CTA remains reachable but does not visually overpower urgent state.
- Board lanes collapse into chips/attention list before the 6-lane board layout appears.
- Runtime terminals are opt-in and show a warning about mobile log density before mounting heavy views.
- Destructive controls are behind confirmation and not placed under accidental thumb zones.

### P1.1 — Acceptance metadata capture and visibility

Problem:
Specialist ownership is not underway until acceptance fields exist, and the current spec found no implementation of those fields.

Slice:
Expose acceptance metadata in task drilldown and use it as a hard prerequisite for dispatch-related UI.

Acceptance criteria:
- Task detail shows all required fields: `accepted_by`, `accepted_at`, `lane`, `scope_understood`, `first_action`, `expected_artifact`, `risk_level`, `will_not_do`.
- Missing fields are grouped in a clear warning.
- `Request dispatch` is disabled with a precise explanation when any field is missing.
- Accepted tasks show a concise `Accepted by X at Y` trust badge.
- Search/filter can find tasks missing acceptance.

### P1.2 — Task-bound dispatch receipt UI

Problem:
Dispatch currently exists, but the UX must show whether dispatch was rejected, queued, claimed/running, or failed.

Slice:
Design the receipt component and related state transitions for `request_dispatch`.

Acceptance criteria:
- Receipt includes task id, mission id, assignment id, worker id, delivery mode, timestamp, checkpoint wait mode, and verification state.
- UI starts at `Dispatch queued` until canonical run evidence confirms claim.
- Rejected receipts show exact cause: missing acceptance, wrong assignee, stale version, invalid worker, task not ready, unauthenticated.
- Failed receipts include retry guidance and do not alter task truth.
- Receipt is visible in task detail and in a recent operator-actions log.

### P1.3 — Worker-control detail drawer

Problem:
Worker cards currently show useful summaries but lack a dedicated operator diagnostic/control layer.

Slice:
Add a worker detail drawer that resolves runtime + mission + task data into one operational view.

Acceptance criteria:
- Drawer shows identity, role, model/provider, current task id/title, current step, last useful signal, state age, auth/tool errors, artifacts/previews, and recent checkpoint.
- Safe actions: open runtime, open task, open artifacts, add routing note, request dispatch when task-bound and valid.
- Sensitive actions: reclaim, reassign, retry, restart require reason and receipt.
- Direct free-form dispatch is visually separated from task-bound dispatch and labeled as lower-audit / not canonical unless bound.
- Keyboard: drawer traps focus, Escape closes, first action is focusable.

### P1.4 — Human-in-the-loop / blocked-answer flow

Problem:
Inbox has a `Blocked / needs input` lane, but the operator needs a focused path to answer, route, or defer.

Slice:
Create a `Needs input` detail pattern shared by Inbox and Board.

Acceptance criteria:
- Shows the exact question/blocker, who asked, task/run id, age, and consequence of not answering.
- Allows operator to add an answer/comment through the safe action endpoint once implemented.
- If write controls are not implemented, clearly instructs where to answer canonically.
- After answer/request, UI shows pending verification instead of assuming unblock.
- Mobile: one primary action `Answer / route` and secondary `Open task`.

### P1.5 — Failed/stale work triage

Problem:
Mission-control screenshots show failed counts can dominate, and Matrix runtime can silently become stale if last output is old.

Slice:
Add failure/staleness classification and triage cards.

Acceptance criteria:
- Stale threshold is explicit and configurable by state type.
- Failed items distinguish auth/provider, worker startup, tool/process, task blocked, test/build failure, and unknown.
- Each failed/stale item has suggested next action: retry, inspect logs, reassign, answer blocker, or escalate.
- Failed retry controls require task-bound receipt when connected to Kanban.
- High failed counts appear in radar before low-value healthy summaries.

### P1.6 — Mobile live output bridge

Problem:
Runtime/logs are necessary but too heavy as the first mobile troubleshooting surface.

Slice:
Add a structured output preview before raw terminal/logs on mobile.

Acceptance criteria:
- Shows latest summary, last 5 important events, errors/warnings, active tool/process, and jump to raw output.
- Raw output has search, pause autoscroll, copy, and error-only filter.
- Runtime terminal mounts only after explicit tap on mobile.
- If tmux is unavailable, the fallback explanation is short and action-oriented.

### P2.1 — Board attention layout alternative

Problem:
Six lanes work on wide desktop but become a long stack on mobile and can hide priority.

Slice:
Add an `Attention` layout for Board beside lane layout.

Acceptance criteria:
- Desktop can toggle `Lanes` / `Attention`.
- Mobile defaults to `Attention`.
- Attention groups: `Needs input`, `Ready to dispatch`, `Running/stale`, `Review`, `Done with follow-up`, `Evidence warnings`, `Recently updated`.
- Lane counts remain visible as chips.
- Sorting is deterministic and documented.

### P2.2 — Operator action history

Problem:
Once Matrix gains bounded writes, operators need to see what Matrix did, not only what workers did.

Slice:
Add a recent operator-actions panel.

Acceptance criteria:
- Shows action, actor/session label, target task/worker, timestamp, reason, receipt state.
- Filters by rejected/queued/claimed/failed.
- Links back to canonical task comments/events when available.
- Does not become the sole audit store; it mirrors canonical evidence.

### P2.3 — Visual hierarchy polish pass

Problem:
The existing UI has strong individual components, but the overall cockpit can become dense: hub, router, budget, agent grid, board, inbox, runtime.

Slice:
Run a visual hierarchy pass after P0/P1 semantics are in place.

Acceptance criteria:
- One primary focal point per mode.
- Router CTA is prominent when composing/dispatching, secondary during triage.
- Budget cockpit is warning-prominent only when thresholds/auth fail; otherwise compact.
- Topology/wires are decorative support, not the primary answer on mobile.
- Empty states explain what data source is missing and the next setup action.

## 4. Recommended implementation order

1. P0.1 root `DESIGN.md` contract.
2. P0.2 next-action radar data shape and static UI.
3. P0.3 canonical state/explanation labels across worker/task cards.
4. P0.4 task drilldown decision header.
5. P0.5 mobile order and attention-first responsive layout.
6. P1.1 acceptance metadata visibility.
7. P1.2 dispatch receipt UI, following the safe mutation spec.
8. P1.3 worker detail drawer.
9. P1.4 blocked-answer flow.
10. P1.5 failed/stale triage.
11. P1.6 mobile live-output bridge.
12. P2 polish: board attention layout, operator action history, visual hierarchy pass.

## 5. Non-goals for the next UX slice

- No direct `done` mutation from Matrix.
- No direct optimistic `running` labels without canonical claim/run evidence.
- No drag-and-drop lane mutation across arbitrary statuses until the control policy exists.
- No free-form dispatch presented as equivalent to task-bound canonical dispatch.
- No mobile terminal-first troubleshooting as the default flow.
- No visual redesign that hides current read-only safety/audit semantics.

## 6. Sign-off gate for future Matrix UI changes

A Matrix UI slice is not ready for design sign-off unless it provides:

- visual evidence at desktop and mobile widths
- state coverage for empty/loading/error/unauthorized/stale/blocked/review/done-with-follow-up
- keyboard/focus behavior for dialogs/drawers/actions
- proof that labels do not overclaim task state
- clear acceptance criteria tied to canonical task/run evidence
- confirmation that root `DESIGN.md` is still satisfied
