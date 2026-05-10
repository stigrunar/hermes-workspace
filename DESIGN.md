# DESIGN.md — The Matrix cockpit

Status: root design contract for The Matrix surfaces in this checkout
Scope: `/swarm2`, Matrix Board, Matrix Inbox, Matrix Runtime, Matrix budget cockpit, and related operator-control affordances.

This contract applies to the Matrix cockpit layer in this repo. It does not attempt to redesign every upstream Hermes Workspace screen.

## Product promise

The Matrix is an operator cockpit. It should answer:

1. What needs operator attention now?
2. What is running normally?
3. What is blocked, stale, failed, or unsafe to trust?
4. Which canonical task/run/worker evidence proves that state?
5. What is the safest next action?

The Matrix must not become a second completion engine. It may prepare, route, block, comment, and request dispatch, but workers own true `running`, `done`, completion evidence, and final handoff semantics.

## Information hierarchy

Default priority order:

1. Global cockpit state and data freshness.
2. Next-action radar: needs input, review-ready, stale running, failed/degraded dispatch, auth/provider warnings, done-with-follow-up, missing evidence.
3. Focused task/worker/report detail for the selected action.
4. Worker-control visibility: current activity, evidence source, state age, last useful signal.
5. Board/Inbox navigation and drilldown.
6. Budget/auth summary, promoted only when warning/limit/degraded.
7. Runtime terminal/log views, mounted on demand.
8. Topology/wires/office visualization as orientation, not the primary decision layer.

## State vocabulary

Use precise state labels. Do not show ambiguous labels alone.

Allowed/operator-facing meanings:

- `assigned`: task has an assignee/profile, but specialist acceptance may still be missing.
- `accepted`: required specialist acceptance metadata exists.
- `ready for dispatch`: task can be requested for dispatch; not yet running.
- `dispatch queued`: Matrix/control plane requested dispatch, waiting for canonical claim/run evidence.
- `claimed / running`: canonical dispatcher/worker evidence exists.
- `blocked / needs input`: worker/task requires input or dependency resolution.
- `needs review`: handoff is ready for peer/human review; do not imply final done.
- `ready handoff`: output exists and can be inspected/routed.
- `done via worker`: worker-owned completion event/run evidence exists.
- `done with follow-up`: scoped slice is done, but linked child/follow-up remains open or blocked.
- `evidence missing`: UI cannot prove the state from canonical run/event evidence.
- `unknown / fallback`: data is inferred or unavailable; visually mute it.

Forbidden overclaims:

- Do not label a task `running` from optimistic Matrix state alone.
- Do not label a task `done` unless canonical worker completion evidence exists.
- Do not hide open children/follow-up behind a green done state.
- Do not use `Ready` alone; specify `Ready for dispatch`, `Ready handoff`, or `Worker idle`.

## Visual system

Tone: calm technical cockpit, not generic SaaS cards.

Density:

- Desktop may show topology, lanes, and detail together.
- Mobile must be attention-first and avoid full six-lane boards as the opening view.
- Runtime/terminal views are heavy surfaces and should be mounted only after explicit intent on mobile.

Color semantics:

- Green: proven healthy/completed state backed by evidence.
- Amber: waiting, queued, follow-up open, partial trust, budget warning.
- Red: blocked, failed, missing evidence, auth/provider error, unsafe mutation.
- Blue/violet: review, routing, informational control state.
- Muted gray/slate: fallback, unknown, historical, inactive.

Do not use color alone. Pair state color with label and evidence/reason text.

Typography and spacing:

- Prefer compact, readable operational text over decorative hero type.
- Status labels use short phrases; explanations use one-line reason text first, detail second.
- Minimum mobile touch target: 44px for primary rows/actions.
- Avoid icon-only critical controls unless visible label or accessible text is present.

## Component rules

### Next-action radar

Must show:

- severity
- action label
- why this matters
- evidence source
- target route/detail
- last updated/freshness

Empty state: `No operator action needed` plus freshness timestamp.

### Worker card / worker drawer

Must show:

- worker id/name/role/model if available
- current task id/title if bound
- state label and state age
- evidence source (`kanban`, `mission`, `runtime`, `fallback`)
- last useful signal
- safe actions and sensitive actions separated

Sensitive actions require a reason and receipt once write/control endpoints exist.

### Board card

Must show:

- source board badge
- canonical lane/status
- assignee/profile
- acceptance present/missing
- run evidence present/missing
- open follow-up/done-audit warnings
- updated time

### Task drilldown

Open with a decision header before raw body/comments/runs.

Header must include:

- current operator-facing state
- trust/evidence status
- owner/assignee
- acceptance state and missing fields if any
- blockers/follow-up warnings
- next safe action

Raw details (body, result, comments, runs, workspace) stay below the decision header.

### Budget cockpit

Budget/auth is advisory unless the UI explicitly enters an enforcement mode.

- Healthy budget/provider state should remain compact.
- Warning/limit/auth failures may enter the radar.
- Cost labels must distinguish precise, partial, included, and unknown.

### Runtime/log view

Runtime is not the first troubleshooting answer on mobile.

Before raw logs, show:

- latest summary
- important recent events
- errors/warnings
- active process/tool if available
- link to raw output

## Accessibility and interaction

- Dialogs/drawers trap focus and close with Escape.
- All status-only color cues need text labels.
- All destructive actions require confirmation and reason.
- Loading, empty, unauthorized, stale, blocked, and error states must have explicit copy.
- Keyboard users must be able to reach radar items, worker cards, task drilldown, and action controls.
- Mobile layouts must not place destructive actions under accidental thumb zones.

## Evidence and sign-off

A Matrix UI slice is not ready for design sign-off unless it includes:

- desktop and mobile visual evidence
- empty/loading/error/unauthorized state coverage
- blocked/review/done-with-follow-up/missing-evidence state coverage where relevant
- no optimistic `running`/`done` labels without canonical evidence
- acceptance criteria tied to task/run evidence
- regression checks or screenshots showing the affected mode

## Current backlog pointer

The active UX backlog and flow map is:

- `docs/matrix-operator-cockpit-ux-backlog.md`
