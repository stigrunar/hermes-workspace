import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createKanbanCard, updateKanbanCard } from './kanban-backend'
import {
  appendCanonicalComment,
  appendCanonicalEvent,
  linkCanonicalTasks,
  loadCanonicalTask,
  resolveCanonicalBoardDbPath,
  wakeBlockedTaskOnComment,
} from './swarm-kanban-canonical'
import { getAssigneeDispatchSupport, getAssigneeTaskScopeSupport, readHermesConfig } from './kanban-assignees'
import { applyMatrixKanbanControl } from './swarm-kanban-control'

vi.mock('./kanban-backend', () => ({
  createKanbanCard: vi.fn(),
  updateKanbanCard: vi.fn(),
}))

vi.mock('./swarm-kanban-canonical', () => ({
  appendCanonicalComment: vi.fn(),
  appendCanonicalEvent: vi.fn(),
  createMutationId: vi.fn(() => 'mx_test_1'),
  linkCanonicalTasks: vi.fn(),
  loadCanonicalTask: vi.fn(),
  resolveCanonicalBoardDbPath: vi.fn(() => '/tmp/kanban.db'),
  wakeBlockedTaskOnComment: vi.fn(() => false),
}))

vi.mock('./kanban-assignees', () => ({
  getAssigneeDispatchSupport: vi.fn(),
  getAssigneeTaskScopeSupport: vi.fn(),
  readHermesConfig: vi.fn(() => ({ tasks: { human_reviewer: 'reviewer' } })),
}))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(readHermesConfig).mockReturnValue({ tasks: { human_reviewer: 'reviewer' } })
  vi.mocked(getAssigneeDispatchSupport).mockReturnValue({
    dispatchSupported: true,
    dispatchReason: null,
  })
  vi.mocked(getAssigneeTaskScopeSupport).mockReturnValue({
    allowed: true,
    reason: null,
  })
  vi.mocked(loadCanonicalTask).mockReturnValue({
    dbPath: '/tmp/kanban.db',
    task: {
      id: 't_demo',
      title: 'Demo',
      body: 'Spec',
      assignee: 'dollycode',
      status: 'ready',
    },
  })
})

describe('applyMatrixKanbanControl', () => {
  it('rejects direct running on create_task', async () => {
    const result = await applyMatrixKanbanControl({
      action: 'create_task',
      title: 'Bad',
      status: 'running',
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: expect.stringContaining('Direct running status is not allowed'),
    })
    expect(createKanbanCard).not.toHaveBeenCalled()
  })

  it('rejects unsupported assignees before mutating canonical tasks', async () => {
    vi.mocked(getAssigneeDispatchSupport).mockReturnValue({
      dispatchSupported: false,
      dispatchReason: 'Profile "workspace" has no configured model, so Matrix cannot dispatch it as a Kanban worker.',
    })

    const result = await applyMatrixKanbanControl({
      action: 'create_task',
      title: 'Needs real worker',
      assignedWorker: 'workspace',
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Profile "workspace" has no configured model, so Matrix cannot dispatch it as a Kanban worker.',
    })
    expect(createKanbanCard).not.toHaveBeenCalled()
    expect(updateKanbanCard).not.toHaveBeenCalled()
  })

  it('rejects numeric swarm assignees for PM/spec/routing task scope', async () => {
    vi.mocked(getAssigneeTaskScopeSupport).mockReturnValue({
      allowed: false,
      reason: 'Assignee "swarm3" cannot own PM/spec/governance/next-phase routing work from The Matrix. Route this task to a named durable owner such as default, dollydesign, dollyops, dollyresearch, dollyqa, or dollycode instead.',
    })

    const result = await applyMatrixKanbanControl({
      action: 'create_task',
      title: 'Synthesize kickoff research and route next phase',
      body: 'Update PROJECT_BRIEF.md and TASKS.md with the governance decision.',
      assignedWorker: 'swarm3',
    })

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: 'Assignee "swarm3" cannot own PM/spec/governance/next-phase routing work from The Matrix. Route this task to a named durable owner such as default, dollydesign, dollyops, dollyresearch, dollyqa, or dollycode instead.',
    })
    expect(createKanbanCard).not.toHaveBeenCalled()
  })

  it('returns explicit receipts for allowed safe status moves', async () => {
    vi.mocked(updateKanbanCard).mockResolvedValue({
      id: 't_demo',
      title: 'Demo',
      spec: 'Spec',
      acceptanceCriteria: [],
      assignedWorker: 'dollycode',
      reviewer: null,
      status: 'ready',
      missionId: null,
      reportPath: null,
      createdBy: 'matrix',
      createdAt: 1,
      updatedAt: 2,
    })

    const result = await applyMatrixKanbanControl({
      action: 'mark_ready',
      taskId: 't_demo',
      board: 'mission-control',
      reason: 'Spec clarified',
    })

    expect(updateKanbanCard).toHaveBeenCalledWith('t_demo', { status: 'ready' })
    expect(result).toMatchObject({
      ok: true,
      receipt: {
        action: 'mark_ready',
        taskId: 't_demo',
        status: 'ready',
        assignee: 'dollycode',
        audit: { commentWritten: true, eventWritten: true },
      },
    })
    expect(appendCanonicalComment).toHaveBeenCalled()
    expect(appendCanonicalEvent).toHaveBeenCalled()
  })

  it('supports canonical comment and link actions with receipts', async () => {
    const commentResult = await applyMatrixKanbanControl({
      action: 'add_comment',
      taskId: 't_demo',
      comment: 'Operator note',
    })
    expect(commentResult).toMatchObject({
      ok: true,
      receipt: { action: 'add_comment', taskId: 't_demo' },
    })
    expect(wakeBlockedTaskOnComment).toHaveBeenCalledWith({
      dbPath: '/tmp/kanban.db',
      taskId: 't_demo',
      actor: 'matrix',
      mutationId: 'mx_test_1',
      reason: 'Matrix comment added to blocked task',
    })

    vi.mocked(loadCanonicalTask)
      .mockReturnValueOnce({
        dbPath: '/tmp/kanban.db',
        task: { id: 't_demo', title: 'Demo', status: 'ready', assignee: 'dollycode' },
      })
      .mockReturnValueOnce({
        dbPath: '/tmp/kanban.db',
        task: { id: 't_parent', title: 'Parent', status: 'blocked', assignee: 'dollyops' },
      })

    const linkResult = await applyMatrixKanbanControl({
      action: 'link_parent',
      taskId: 't_demo',
      parentTaskId: 't_parent',
    })
    expect(resolveCanonicalBoardDbPath).toHaveBeenCalled()
    expect(linkCanonicalTasks).toHaveBeenCalledWith({
      dbPath: '/tmp/kanban.db',
      parentTaskId: 't_parent',
      childTaskId: 't_demo',
    })
    expect(linkResult).toMatchObject({
      ok: true,
      receipt: { action: 'link_parent', taskId: 't_demo' },
    })
  })

  it('wakes a blocked task back to ready when Matrix adds operator input', async () => {
    vi.mocked(wakeBlockedTaskOnComment).mockReturnValue(true)
    vi.mocked(loadCanonicalTask).mockReturnValue({
      dbPath: '/tmp/kanban.db',
      task: { id: 't_demo', title: 'Demo', status: 'blocked', assignee: 'dollycode' },
    })

    const result = await applyMatrixKanbanControl({
      action: 'add_comment',
      taskId: 't_demo',
      comment: 'The missing input is now here; continue.',
      actor: 'stig',
    })

    expect(result).toMatchObject({
      ok: true,
      receipt: { action: 'add_comment', taskId: 't_demo', status: 'ready', assignee: 'dollycode' },
    })
  })
})