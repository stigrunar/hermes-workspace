import { createKanbanCard, updateKanbanCard } from './kanban-backend'
import {
  appendCanonicalComment,
  appendCanonicalEvent,
  createMutationId,
  linkCanonicalTasks,
  loadCanonicalTask,
  resolveCanonicalBoardDbPath,
} from './swarm-kanban-canonical'

export type MatrixKanbanControlAction =
  | 'create_task'
  | 'edit_task'
  | 'assign_task'
  | 'mark_ready'
  | 'mark_blocked'
  | 'add_comment'
  | 'link_parent'
  | 'reclaim_worker'
  | 'reassign_worker'

export type MatrixKanbanControlInput = {
  board?: string | null
  action: MatrixKanbanControlAction
  actor?: string | null
  reason?: string | null
  taskId?: string | null
  parentTaskId?: string | null
  title?: string | null
  body?: string | null
  assignedWorker?: string | null
  status?: 'backlog' | 'ready' | 'blocked' | 'running' | 'review' | 'done' | null
  comment?: string | null
}

export type MatrixKanbanControlReceipt = {
  mutationId: string
  action: MatrixKanbanControlAction
  taskId: string
  board: string | null
  actor: string
  status: string | null
  assignee: string | null
  audit: {
    commentWritten: boolean
    eventWritten: boolean
  }
}

export type MatrixKanbanControlResult =
  | { ok: true; receipt: MatrixKanbanControlReceipt }
  | { ok: false; status: number; error: string }

const DIRECT_DONE_ERROR = 'Direct done status is not allowed from The Matrix. Complete it through the worker/kanban_complete path so evidence, handoff, and follow-up semantics are preserved.'
const DIRECT_RUNNING_ERROR = 'Direct running status is not allowed from The Matrix. Request dispatch on a ready task so canonical claim/run evidence moves it into running.'
const DIRECT_REVIEW_ERROR = 'Direct review status is not allowed from The Matrix. Leave a comment or routing note instead of implying worker progress.'

function normalizeActor(input: string | null | undefined): string {
  const trimmed = input?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : 'matrix'
}

function conflict(error: string): MatrixKanbanControlResult {
  return { ok: false, status: 409, error }
}

function badRequest(error: string): MatrixKanbanControlResult {
  return { ok: false, status: 400, error }
}

function requiresReason(reason: string | null | undefined, action: MatrixKanbanControlAction): MatrixKanbanControlResult | null {
  return reason?.trim() ? null : badRequest(`${action} requires an explicit reason`)
}

function blocksWorkerReclaim(task: ReturnType<typeof loadCanonicalTask>): MatrixKanbanControlResult | null {
  if (!task) return { ok: false, status: 404, error: 'Task not found' }
  const status = task.task.status?.toLowerCase() ?? ''
  if (status === 'running' || status === 'claimed' || status === 'in_progress' || typeof task.task.current_run_id === 'number') {
    return conflict('Reclaim/reassign is only allowed before canonical claim/run evidence exists. Use the dispatcher/worker lifecycle instead.')
  }
  return null
}

function forbiddenStatus(status: MatrixKanbanControlInput['status']): string | null {
  if (status === 'done') return DIRECT_DONE_ERROR
  if (status === 'running') return DIRECT_RUNNING_ERROR
  if (status === 'review') return DIRECT_REVIEW_ERROR
  return null
}

function auditSummary(input: { action: MatrixKanbanControlAction; actor: string; reason?: string | null; taskId: string; extra?: string | null }): string {
  const base = `[Matrix control] ${input.actor} -> ${input.action} on ${input.taskId}`
  const detail = input.extra?.trim() ? ` | ${input.extra.trim()}` : ''
  const reason = input.reason?.trim() ? ` | reason: ${input.reason.trim()}` : ''
  return `${base}${detail}${reason}`
}

async function receiptFromTask(input: {
  action: MatrixKanbanControlAction
  actor: string
  board?: string | null
  taskId: string
  mutationId: string
  reason?: string | null
  extra?: string | null
}): Promise<MatrixKanbanControlResult> {
  const resolved = loadCanonicalTask(input.taskId, input.board)
  const summary = auditSummary({
    action: input.action,
    actor: input.actor,
    reason: input.reason,
    taskId: input.taskId,
    extra: input.extra,
  })
  if (resolved) {
    appendCanonicalComment({
      dbPath: resolved.dbPath,
      taskId: input.taskId,
      author: input.actor,
      body: summary,
    })
    appendCanonicalEvent({
      dbPath: resolved.dbPath,
      taskId: input.taskId,
      kind: 'matrix_control',
      payload: {
        mutationId: input.mutationId,
        action: input.action,
        actor: input.actor,
        reason: input.reason ?? null,
        detail: input.extra ?? null,
      },
    })
  }
  const current = loadCanonicalTask(input.taskId, input.board)
  return {
    ok: true,
    receipt: {
      mutationId: input.mutationId,
      action: input.action,
      taskId: input.taskId,
      board: input.board ?? null,
      actor: input.actor,
      status: current?.task.status ?? null,
      assignee: current?.task.assignee ?? null,
      audit: {
        commentWritten: Boolean(resolved),
        eventWritten: Boolean(resolved),
      },
    },
  }
}

export async function applyMatrixKanbanControl(input: MatrixKanbanControlInput): Promise<MatrixKanbanControlResult> {
  const actor = normalizeActor(input.actor)
  const mutationId = createMutationId()

  switch (input.action) {
    case 'create_task': {
      const title = input.title?.trim()
      if (!title) return badRequest('title is required for create_task')
      const forbidden = forbiddenStatus(input.status ?? 'backlog')
      if (forbidden) return conflict(forbidden)
      const status = input.status ?? 'backlog'
      const created = await createKanbanCard({
        title,
        spec: input.body?.trim() ?? '',
        assignedWorker: input.assignedWorker?.trim() || null,
        status,
        createdBy: actor,
      })
      return receiptFromTask({
        action: input.action,
        actor,
        board: input.board,
        taskId: created.id,
        mutationId,
        reason: input.reason,
        extra: created.assignedWorker ? `assignee=${created.assignedWorker}` : `status=${created.status}`,
      })
    }
    case 'edit_task': {
      if (!input.taskId?.trim()) return badRequest('taskId is required for edit_task')
      if (!input.title?.trim() && input.body === undefined) {
        return badRequest('edit_task requires title or body')
      }
      const updated = await updateKanbanCard(input.taskId, {
        title: input.title?.trim(),
        spec: input.body ?? undefined,
      })
      if (!updated) return { ok: false, status: 404, error: 'Task not found' }
      return receiptFromTask({
        action: input.action,
        actor,
        board: input.board,
        taskId: input.taskId,
        mutationId,
        reason: input.reason,
        extra: 'edited title/body',
      })
    }
    case 'assign_task': {
      if (!input.taskId?.trim()) return badRequest('taskId is required for assign_task')
      const updated = await updateKanbanCard(input.taskId, {
        assignedWorker: input.assignedWorker?.trim() || null,
      })
      if (!updated) return { ok: false, status: 404, error: 'Task not found' }
      return receiptFromTask({
        action: input.action,
        actor,
        board: input.board,
        taskId: input.taskId,
        mutationId,
        reason: input.reason,
        extra: `assignee=${updated.assignedWorker ?? 'unassigned'}`,
      })
    }
    case 'mark_ready': {
      if (!input.taskId?.trim()) return badRequest('taskId is required for mark_ready')
      const updated = await updateKanbanCard(input.taskId, { status: 'ready' })
      if (!updated) return { ok: false, status: 404, error: 'Task not found' }
      return receiptFromTask({
        action: input.action,
        actor,
        board: input.board,
        taskId: input.taskId,
        mutationId,
        reason: input.reason,
        extra: 'status=ready',
      })
    }
    case 'mark_blocked': {
      if (!input.taskId?.trim()) return badRequest('taskId is required for mark_blocked')
      const updated = await updateKanbanCard(input.taskId, { status: 'blocked' })
      if (!updated) return { ok: false, status: 404, error: 'Task not found' }
      return receiptFromTask({
        action: input.action,
        actor,
        board: input.board,
        taskId: input.taskId,
        mutationId,
        reason: input.reason,
        extra: 'status=blocked',
      })
    }
    case 'add_comment': {
      if (!input.taskId?.trim()) return badRequest('taskId is required for add_comment')
      const body = input.comment?.trim()
      if (!body) return badRequest('comment is required for add_comment')
      const resolved = loadCanonicalTask(input.taskId, input.board)
      if (!resolved) return { ok: false, status: 404, error: 'Task not found' }
      appendCanonicalComment({ dbPath: resolved.dbPath, taskId: input.taskId, author: actor, body })
      appendCanonicalEvent({
        dbPath: resolved.dbPath,
        taskId: input.taskId,
        kind: 'matrix_comment',
        payload: { mutationId, actor, reason: input.reason ?? null, body },
      })
      return {
        ok: true,
        receipt: {
          mutationId,
          action: input.action,
          taskId: input.taskId,
          board: input.board ?? null,
          actor,
          status: resolved.task.status ?? null,
          assignee: resolved.task.assignee ?? null,
          audit: { commentWritten: true, eventWritten: true },
        },
      }
    }
    case 'link_parent': {
      if (!input.taskId?.trim()) return badRequest('taskId is required for link_parent')
      if (!input.parentTaskId?.trim()) return badRequest('parentTaskId is required for link_parent')
      if (input.taskId === input.parentTaskId) return conflict('A task cannot be linked to itself.')
      const dbPath = resolveCanonicalBoardDbPath(input.board)
      if (!dbPath) return { ok: false, status: 404, error: 'Canonical Kanban DB not found' }
      const child = loadCanonicalTask(input.taskId, input.board)
      const parent = loadCanonicalTask(input.parentTaskId, input.board)
      if (!child || !parent) return { ok: false, status: 404, error: 'Parent or child task not found' }
      linkCanonicalTasks({ dbPath, parentTaskId: input.parentTaskId, childTaskId: input.taskId })
      appendCanonicalComment({
        dbPath,
        taskId: input.taskId,
        author: actor,
        body: auditSummary({ action: input.action, actor, reason: input.reason, taskId: input.taskId, extra: `parent=${input.parentTaskId}` }),
      })
      appendCanonicalEvent({
        dbPath,
        taskId: input.taskId,
        kind: 'matrix_link_parent',
        payload: { mutationId, actor, parentTaskId: input.parentTaskId, reason: input.reason ?? null },
      })
      return {
        ok: true,
        receipt: {
          mutationId,
          action: input.action,
          taskId: input.taskId,
          board: input.board ?? null,
          actor,
          status: child.task.status ?? null,
          assignee: child.task.assignee ?? null,
          audit: { commentWritten: true, eventWritten: true },
        },
      }
    }
    case 'reclaim_worker': {
      if (!input.taskId?.trim()) return badRequest('taskId is required for reclaim_worker')
      const reasonError = requiresReason(input.reason, input.action)
      if (reasonError) return reasonError
      const current = loadCanonicalTask(input.taskId, input.board)
      const blocked = blocksWorkerReclaim(current)
      if (blocked) return blocked
      const updated = await updateKanbanCard(input.taskId, {
        assignedWorker: null,
        status: 'backlog',
      })
      if (!updated) return { ok: false, status: 404, error: 'Task not found' }
      return receiptFromTask({
        action: input.action,
        actor,
        board: input.board,
        taskId: input.taskId,
        mutationId,
        reason: input.reason,
        extra: 'assignee=unassigned | status=backlog',
      })
    }
    case 'reassign_worker': {
      if (!input.taskId?.trim()) return badRequest('taskId is required for reassign_worker')
      const nextAssignee = input.assignedWorker?.trim()
      if (!nextAssignee) return badRequest('assignedWorker is required for reassign_worker')
      const reasonError = requiresReason(input.reason, input.action)
      if (reasonError) return reasonError
      const current = loadCanonicalTask(input.taskId, input.board)
      const blocked = blocksWorkerReclaim(current)
      if (blocked) return blocked
      const updated = await updateKanbanCard(input.taskId, {
        assignedWorker: nextAssignee,
      })
      if (!updated) return { ok: false, status: 404, error: 'Task not found' }
      return receiptFromTask({
        action: input.action,
        actor,
        board: input.board,
        taskId: input.taskId,
        mutationId,
        reason: input.reason,
        extra: `assignee=${updated.assignedWorker ?? nextAssignee}`,
      })
    }
    default:
      return badRequest('Unsupported Matrix control action')
  }
}
