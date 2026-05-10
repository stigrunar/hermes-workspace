# Matrix safe Kanban write + dispatch controls

Status: proposed bounded control-plane spec
Owner for this spec: DollyOps
Scope: The Matrix cockpit write/mutate Kanban actions and worker-control/dispatch UX

## 1) Verified current state

Verified in the live checkout on branch `stig/the-matrix`:

1. `src/routes/api/swarm-kanban.ts`
   - `GET`, `POST`, and `PATCH` are behind `isAuthenticated(request)`.
   - direct `status: 'done'` is rejected with a 409 and a worker/`kanban_complete` message.
2. `src/server/swarm-kanban-query.ts`
   - board reads are still returned as `readOnly: true`.
   - `doneAudit` already exposes:
     - open linked follow-up count/list
     - completed event count
     - completed run count
     - warnings such as `Slice done; ... follow-up open/blocked` and `Done has no completed run/event evidence...`
3. `src/server/kanban-backend.ts`
   - Matrix can still create/update tasks through direct backend writes.
   - the legacy/direct-SQLite backend updates `tasks.status`, `started_at`, and `completed_at` directly.
   - those direct writes do not append worker-style completion evidence, acceptance metadata, or a Matrix-origin audit comment/event.
4. `src/routes/api/swarm-dispatch.ts`
   - dispatch is authenticated and observable by default (`waitForCheckpoint` defaults on).
   - dispatch creates mission/checkpoint telemetry.
   - dispatch is not currently bound to a canonical Kanban task id, specialist acceptance fields, or a dispatch receipt written back onto the task.
5. Repo search found no current implementation of the required specialist acceptance fields:
   - `accepted_by`
   - `accepted_at`
   - `lane`
   - `scope_understood`
   - `first_action`
   - `expected_artifact`
   - `risk_level`
   - `will_not_do`

Conclusion: Matrix already has a good read/audit foundation and a direct-`done` guard, but it does not yet have a safe mutation contract or a dispatch-to-task verification boundary.

## 2) Problem to solve

The Matrix should be allowed to help with Kanban operations without becoming a bypass around the canonical worker lifecycle.

That means Matrix must not:
- mark work `done` directly
- imply specialist work is underway before explicit acceptance exists
- dispatch free-form work that is detached from a task/evidence trail
- mutate canonical tasks without leaving operator-visible audit evidence

## 3) Control-plane invariant

`done` remains worker-owned.

The Matrix may prepare, route, or block work, but canonical completion must still flow through the worker/dispatcher path so the DB keeps:
- completion event evidence
- run evidence
- linked follow-up visibility
- scoped-slice semantics (`slice done; follow-up open/blocked`)

## 4) Allowed Matrix operations

These are safe operations to expose from Matrix once the guard layer exists:

1. Create draft task
   - creates `todo`/`ready`/`blocked` only
   - records `created_via=matrix` and actor/session receipt

2. Edit non-terminal task content
   - title
   - body/spec
   - assignee
   - priority
   - parents/dependencies
   - workspace hints

3. Move task into safe pre-worker lanes
   - `triage` -> `todo`
   - `todo` -> `ready`
   - `ready` -> `blocked`
   - `blocked` -> `ready`
   - `todo` -> `blocked`

4. Add operator comment / routing note
   - rationale
   - blocker note
   - dependency explanation
   - dispatch intent / why this worker

5. Request dispatch for a ready task
   - only through a task-bound dispatch action
   - must produce a dispatch receipt tied to the task id
   - must not itself set `running`

6. Reclaim / reassign / retry controls
   - allowed only as task-bound worker-control actions
   - must append audit comment/event with actor + reason

## 5) Forbidden Matrix operations

These should hard-fail with explicit conflict messages:

1. Direct `done`
2. Direct `running`
3. Direct `review` if that status is meant to imply worker progress rather than an operator note
4. Direct mutation of `completed_at`, `started_at`, `current_run_id`, `result`, or worker-run evidence fields
5. Dispatch without a canonical `taskId`
6. Dispatch when specialist acceptance fields are missing
7. Dispatch to a worker id that does not match the task assignee unless an explicit override + audit reason is provided
8. Silent mutation paths that do not write a Matrix-origin audit record

## 6) Auth and session boundary

Minimum boundary:
- keep `isAuthenticated(request)` on all read/write/dispatch routes
- require Matrix session cookie for all write and worker-control endpoints
- reject write actions when the workspace is password-protected and the request has no valid session

Recommended hardening for write endpoints:
- require JSON content-type and same-origin browser use for write routes
- include a Matrix actor identity in the write envelope (`sessionKey`, user label, or resolved operator id)
- persist an audit-ready request id / mutation id per action

Operational rule:
- "authenticated browser session" is necessary but not sufficient
- each write must also satisfy the mutation policy for that operation

## 7) Mutation model: use explicit actions, not raw status PATCH

Do not expose arbitrary `PATCH { id, status, ... }` as the long-term contract.

Use an action-based control endpoint, for example:

```json
POST /api/swarm-kanban-control
{
  "taskId": "t_xxx",
  "action": "mark_ready",
  "reason": "Spec clarified; ready for specialist pickup",
  "expectedVersion": 12
}
```

Suggested action set:
- `create_task`
- `edit_task`
- `assign_task`
- `link_parent`
- `unlink_parent`
- `mark_ready`
- `mark_blocked`
- `add_comment`
- `request_dispatch`
- `reclaim_worker`
- `reassign_worker`
- `retry_task`

Benefits:
- each action has a narrow allowlist
- easier to audit
- easier to reject invalid transitions with human-readable errors
- easier to keep worker-owned fields immutable

## 8) Acceptance gate before dispatch / underway status

Before Matrix can request dispatch or show specialist work as underway, require acceptance metadata for the assigned specialist.

Required fields:
- `accepted_by`
- `accepted_at`
- `lane`
- `scope_understood`
- `first_action`
- `expected_artifact`
- `risk_level`
- `will_not_do`

Policy:
1. Matrix may create or edit the task before acceptance.
2. Matrix may assign a specialist before acceptance.
3. Matrix may show `assigned`, but not `in progress` / `i arbeid`, until acceptance exists.
4. `request_dispatch` must fail with 409 if any acceptance field is missing.
5. successful dispatch should either:
   - write a dispatcher claim/receipt that moves the canonical task into `running`, or
   - return `queued_for_dispatch` while the canonical dispatcher performs the actual claim.

## 9) Dispatch verification contract

A successful Matrix dispatch request is not just "HTTP 200".

Required receipt payload:
- `taskId`
- `missionId`
- `assignmentId` or equivalent per-worker dispatch id
- target `workerId`
- `delivery` (`tmux` / `oneshot` / queued)
- dispatch timestamp
- checkpoint wait mode
- current task/run state after dispatch attempt

Required writeback onto canonical task:
- Matrix-origin comment or event stating:
  - who requested dispatch
  - which worker was targeted
  - mission/assignment ids
  - whether delivery was immediate, queued, or failed

Required verification states:
1. `rejected`
   - acceptance missing, wrong assignee, invalid worker, stale version, task not ready
2. `queued`
   - accepted by Matrix control plane, waiting for dispatcher claim
3. `claimed/running`
   - canonical task now shows claim/run evidence
4. `failed`
   - delivery or worker startup failed; attach reason

UI rule:
- do not present `running` from Matrix optimism alone
- present `Dispatch queued` until canonical task/run evidence confirms claim

## 10) Audit log and evidence requirements

Every Matrix-origin write must leave durable evidence in canonical storage.

Minimum evidence per mutation:
- task id
- action
- actor/session identifier
- timestamp
- before/after summary
- free-text reason when status/assignee/dispatch changes
- mutation id / request id

For `request_dispatch`, also capture:
- worker id
- mission id
- assignment id
- delivery mode
- verification outcome

Preferred storage order:
1. canonical Kanban event/comment path first
2. Matrix-local UI telemetry second

Do not let Matrix-only logs become the sole evidence for a canonical task mutation.

## 11) Backend design recommendation

Introduce a dedicated server-layer policy function instead of letting route handlers call the generic backend adapter directly.

Recommended structure:
- `swarm-kanban-control-policy.ts`
  - validates actions
  - validates allowed transitions
  - rejects direct terminal/progress writes
  - enforces acceptance fields for dispatch/reclaim/reassign-sensitive actions
  - appends audit comment/event payloads
- `swarm-kanban-control.ts`
  - executes the approved mutation against the selected backend
  - fetches fresh task detail after mutation
  - returns receipt
- `swarm-dispatch.ts`
  - add a task-bound dispatch path instead of free-form worker prompt only
  - require `taskId` for Matrix worker-control dispatches
  - emit dispatch receipt + canonical writeback

Important boundary:
- keep `kanban-backend.ts` as a storage adapter
- do not let UI routes call raw backend update helpers for sensitive actions once the policy layer exists

## 12) Concurrency / stale-write rules

To avoid last-write-wins drift:
- include `expectedVersion` or equivalent optimistic concurrency token on task mutations
- reject stale writes with 409 and return fresh task detail
- require fresh refetch after mutation or conflict

If versioning is too large for slice 1, at minimum require:
- `updatedAt` echo check, or
- compare current assignee/status before executing sensitive transitions

## 13) UI/UX guidance for Matrix

Phase 1 UI should stay intentionally bounded.

Expose:
- create task
- edit task content
- assign worker
- mark ready / blocked
- add routing comment
- request dispatch
- reclaim / reassign with reason

Do not expose yet:
- arbitrary lane drag-and-drop across all statuses
- direct `done`
- direct `running`
- inline editing of worker evidence/result fields

Visible affordances:
- badge: `Read/write bounded controls`
- conflict banners with exact reason (`Acceptance missing: expected_artifact, will_not_do`)
- dispatch receipt card with mission/assignment ids
- canonical-state badge (`Queued`, `Claimed`, `Running`, `Blocked`, `Done via worker`)

## 14) Implementation slices

### Slice A — backend mutation guardrail

Deliver:
- action-based Matrix control endpoint
- no direct `done` / `running`
- Matrix audit comment/event writeback
- optimistic conflict handling

Acceptance:
- unauthorized write -> 401
- direct `done` attempt -> 409
- direct `running` attempt -> 409
- allowed safe actions persist and return receipt

### Slice B — task-bound dispatch verification

Deliver:
- `request_dispatch` action bound to `taskId`
- acceptance-field gate
- canonical dispatch receipt writeback
- status model: rejected / queued / claimed / failed

Acceptance:
- dispatch without `taskId` -> 409/400
- dispatch with missing acceptance fields -> 409
- dispatch success returns mission/assignment/worker receipt
- Matrix UI does not show `running` until canonical evidence exists

### Slice C — Matrix UX + regression coverage

Deliver:
- bounded write controls in Kanban detail panel
- dispatch/reclaim/reassign affordances with explicit reason fields
- tests for auth, transition policy, acceptance gate, and receipt rendering

Acceptance:
- targeted API tests cover allow/deny matrix
- UI smoke confirms warnings/receipts/conflicts are visible
- existing `doneAudit` warnings remain intact

## 15) Risks / pitfalls

1. Proxy/backend mismatch
   - if Matrix writes through a backend that bypasses canonical event helpers, audit evidence will stay incomplete
2. False progress
   - if UI optimistically labels a task `running` before claim evidence exists, Matrix will misreport live state
3. Split-brain comments/events
   - if audit is stored only in Matrix-local telemetry, operators reading canonical Kanban will miss the reason/history
4. Status overloading
   - `review` should not become a vague manual bucket that implies specialist progress without acceptance
5. Direct SQLite temptation
   - easy to implement, but it recreates the exact bypass this spec is trying to prevent

## 16) Recommended rollout order

1. land backend guardrail + control endpoint
2. land task-bound dispatch receipt path
3. wire bounded UI controls
4. run focused API/UI regression
5. only then flip Kanban from `readOnly: true` to bounded mutable mode

## 17) Bottom line

Safe Matrix Kanban mutation is viable, but only if Matrix acts like a bounded operator console rather than a second completion engine.

The hard boundary is simple:
- Matrix can prepare, route, block, and request dispatch.
- workers still own `done`, evidence, and true `running` state.
- every Matrix-origin action must leave a canonical audit trail and a verifiable receipt.
