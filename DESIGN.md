# DESIGN.md — The Matrix UI/Product Design Contract

Status: root UI/product design contract for The Matrix surfaces in this checkout
Scope: `/swarm2`, Matrix Board, Matrix Inbox, Matrix Runtime, Matrix budget cockpit, autonomous continuation controls, and related operator/product affordances.

This file is a **UI and product design contract**. It is not the full system architecture document. Architecture details belong in `README.md`, `docs/`, code, runbooks, or ADR-style knowledge notes. This file should tell designers/builders what the product must feel like, prioritize, expose, and let the operator do.

## Product promise

The Matrix is the Hermes cockpit for getting projects finished.

It should answer, in this order:

1. What is the next thing that moves a project toward shipped?
2. Can Hermes do it now without Stig?
3. If yes: who/what is already running it, or what should be dispatched next?
4. If no: what exact blocker, owner, and unblock condition stops it?
5. What evidence proves the state?

The product mode is **bam boom, next**: when a cron, worker, watchdog, review, or completed task exposes a concrete non-human next action, The Matrix should make continuation the default visible path, not bury it as advisory status. The operator should see momentum: finished slice → next dispatch/review/deploy/fix → receipt → next.

The Matrix is allowed to be an active control plane. It may prepare, assign, mark ready/blocked, comment, request dispatch, route review, surface deploy/fix follow-up, and trigger bounded continuation flows when the data proves the action is safe enough and does not need a human decision. Workers still own their own specialist acceptance, execution evidence, and final completion receipts, but The Matrix owns the product question: **what happens next?**

## Design stance

This is not a generic admin dashboard and not a passive observability board.

Design for:

- fast project momentum over perfect stillness
- concrete next actions over broad status summaries
- automatic follow-through where no human judgment is required
- visible blockers where human judgment is required
- receipts and reversibility instead of paralysis
- mobile-first steering without forcing Stig to babysit every topic

Avoid designing the UI around “safest smallest next slice” as the default. Small slices are useful for risky changes, but the product should accelerate completion of long-running plans. If a project has an existing plan and the next step is clear, the UI should push it forward.

## Information hierarchy

Default priority order:

1. **Continuation queue** — next actions that should be running now.
2. **Autonomous dispatch status** — queued, claimed, running, review, deploy, or blocked.
3. **Project momentum** — active plan stage, latest concrete evidence, and next milestone.
4. **Blockers requiring Stig** — decision/input/approval only; not routine worker chaining.
5. **Worker and profile state** — owner, acceptance, heartbeat, last useful signal.
6. **Board/Inbox navigation and drilldown** — important, but secondary to action flow.
7. **Budget/auth warnings** — promoted when they block or materially constrain execution.
8. **Runtime/log views** — mounted on demand for debugging, not the landing experience.
9. **Topology/office visualization** — orientation and delight, not the primary decision layer.

## Core screens

### 1. Momentum home

The opening view should show:

- projects with active continuation available
- what The Matrix is doing next automatically
- what needs human input
- recently completed slices and the next action spawned from each
- stale projects with no justified blocker

Primary empty state is not merely `No operator action needed`. Use:

`No human action needed. Autonomous continuation is clear or idle.`

If there is open project work and no worker/action is moving it, that is not a healthy empty state. Show it as `stalled / needs routing`.

### 2. Continuation queue

Must show every actionable next step as a queue item with:

- project/topic/board
- next action label
- why it is the next move
- whether it can auto-run
- assigned profile/lane
- current lifecycle state
- evidence source
- last updated/freshness
- receipt link when triggered

Controls should support:

- `Run next`
- `Route to lane`
- `Start review`
- `Deploy / verify`
- `Park with reason`
- `Ask Stig`
- `Open plan`

The default button should be the progress-making action when it is non-destructive and evidence-backed.

### 3. Project drilldown

Open with a decision header before raw body/comments/runs.

Header must include:

- current product stage
- latest evidence
- next action
- autonomous eligibility: `auto-run`, `needs review`, `needs Stig`, or `blocked`
- owner/assignee
- acceptance state where relevant
- blocker/follow-up warnings
- visible Telegram topic target when bound

Raw task bodies, comments, runs, workspaces, and logs stay below the decision header.

### 4. Worker card / worker drawer

Must show:

- worker id/name/role/model if available
- current task id/title if bound
- lifecycle state and state age
- evidence source (`kanban`, `mission`, `runtime`, `fallback`)
- last useful signal
- next expected output
- safe actions and sensitive actions separated

The worker view should make handoffs obvious: what just finished, what it unlocks, and which profile should take it next.

### 5. Board card

Must show:

- source board badge
- canonical lane/status
- assignee/profile
- acceptance present/missing where relevant
- run evidence present/missing
- open follow-up/done-audit warnings
- next action, not just status
- updated time

A completed slice with open follow-up should visually read as **momentum**, not as “green and forgotten”.

### 6. Budget cockpit

Budget/auth is operational context, not a reason to freeze the whole cockpit.

- Healthy budget/provider state stays compact.
- Warning/limit/auth failures enter the continuation queue only when they block progress or risk runaway spend.
- Cost labels must distinguish precise, partial, included, and unknown.
- Expensive actions should show expected lane/model before dispatch.

### 7. Runtime/log view

Runtime is not the first troubleshooting answer on mobile.

Before raw logs, show:

- latest summary
- important recent events
- errors/warnings
- active process/tool if available
- suggested fix or next dispatch
- link to raw output

## State vocabulary

Use precise labels. Do not show ambiguous labels alone.

Allowed/operator-facing meanings:

- `next ready`: concrete next action exists and can be started.
- `auto-running`: The Matrix/dispatcher has triggered the next action and is waiting for canonical worker evidence.
- `dispatch queued`: control plane requested dispatch; waiting for claim/run evidence.
- `claimed / running`: canonical dispatcher/worker evidence exists.
- `accepted`: required specialist acceptance metadata exists.
- `needs review`: output is ready for peer/human review; not final done.
- `ready handoff`: output exists and can be inspected/routed.
- `blocked / needs Stig`: human decision/input/approval is required.
- `blocked / external`: external system, credentials, runtime, or third-party constraint blocks progress.
- `done via worker`: worker-owned completion event/run evidence exists.
- `done with follow-up`: scoped slice is done and linked follow-up remains open.
- `stalled`: open work exists, but no valid next action/owner/worker is moving it.
- `evidence missing`: UI cannot prove the state from canonical run/event evidence.
- `unknown / fallback`: data is inferred or unavailable; visually mute it.

Forbidden overclaims:

- Do not label a task `running` from optimistic Matrix state alone.
- Do not label a task `done` unless canonical worker completion evidence exists.
- Do not hide open children/follow-up behind a green done state.
- Do not use `Ready` alone; specify `next ready`, `ready for dispatch`, `ready handoff`, or `worker idle`.
- Do not report a project as healthy/idle when open work has a clear next action that simply was not triggered.

## Autonomous continuation design rules

Autonomy is the default for non-human next steps.

Auto-run is appropriate when:

- an existing plan or task chain defines the next action
- the action is bounded to a known project/topic/board
- the owner/profile is known
- no human approval/input is required
- rollback/receipts are possible or the action is read/review/route-only
- the action advances a long-running project toward a concrete artifact

Human gate is required when:

- credentials/secrets/payment/public posting are involved
- user/customer approval is needed
- scope or product direction is genuinely ambiguous
- destructive data changes are not reversible
- acting as Stig's voice externally

UI copy should distinguish these cases clearly:

- `Running next automatically`
- `Ready to run next`
- `Needs review before next`
- `Needs Stig decision`
- `Parked intentionally`

If the system detects a concrete next action but cannot run it, it must show why, not silently wait.

## Visual system

Tone: high-velocity technical cockpit. Calm enough to trust, but visually oriented around motion, queues, handoffs, and product progress.

Density:

- Desktop may show momentum queue, project lanes, worker state, and detail together.
- Mobile opens attention-first: continuation queue + blockers + latest receipts.
- Full multi-column boards are drilldown views, not the mobile home screen.
- Runtime/terminal views are heavy surfaces and mount only after explicit intent on mobile.

Color semantics:

- Green: proven healthy/completed state backed by evidence.
- Electric blue/violet: active routing, continuation, dispatch, review flow.
- Amber: waiting, queued, follow-up open, partial trust, budget warning.
- Red: blocked, failed, missing evidence, auth/provider error, unsafe mutation.
- Muted gray/slate: fallback, unknown, historical, inactive, intentionally parked.

Do not use color alone. Pair state color with label and evidence/reason text.

Typography and spacing:

- Prefer compact, readable operational text over decorative hero type.
- Status labels use short action phrases; explanations use one-line reason text first, detail second.
- Minimum mobile touch target: 44px for primary rows/actions.
- Avoid icon-only critical controls unless visible label or accessible text is present.

## Interaction rules

- Default action on a continuation item should move work forward when non-destructive.
- `Ask Stig` should be reserved for real human decisions, not routine dispatch chaining.
- `Park` requires a reason and should make the unblock/review condition visible.
- `Run next` should write or link a receipt when control endpoints support it.
- Review gates should create/route the review step instead of leaving a completed slice idle.
- Deploy/fix follow-up after visible UI/runtime changes should be offered or auto-run when already operationally safe.

## Accessibility and interaction

- Dialogs/drawers trap focus and close with Escape.
- All status-only color cues need text labels.
- Destructive actions require confirmation and reason.
- Loading, empty, unauthorized, stale, blocked, and error states must have explicit copy.
- Keyboard users must be able to reach continuation items, worker cards, task drilldown, and action controls.
- Mobile layouts must not place destructive actions under accidental thumb zones.

## Evidence and sign-off

A Matrix UI slice is not ready for design sign-off unless it includes:

- desktop and mobile visual evidence
- empty/loading/error/unauthorized state coverage
- autonomous continuation / ready-next / stalled / blocked / review / done-with-follow-up states where relevant
- no optimistic `running`/`done` labels without canonical evidence
- acceptance criteria tied to task/run evidence
- regression checks or screenshots showing the affected mode
- proof that a completed slice exposes or triggers the next step instead of disappearing

## Current backlog pointer

The active UX backlog and flow map is:

- `docs/matrix-operator-cockpit-ux-backlog.md`

That backlog should be interpreted through this contract: Matrix exists to move projects forward quickly, not only to report that they are stuck.
