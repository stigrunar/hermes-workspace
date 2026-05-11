import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import { createOrUpdateMission } from '../../server/swarm-missions'
import { rosterByWorkerId } from '../../server/swarm-roster'
import {
  appendCanonicalComment,
  appendCanonicalEvent,
  findTaskAcceptance,
  loadCanonicalTask,
  writeTaskAcceptance,
} from '../../server/swarm-kanban-canonical'
import { getAssigneeDispatchSupport, getAssigneeTaskScopeSupport, readHermesConfig } from '../../server/kanban-assignees'
import { Route } from './swarm-dispatch'

vi.mock('../../server/auth-middleware', () => ({ isAuthenticated: vi.fn() }))
vi.mock('../../server/swarm-missions', () => ({
  createOrUpdateMission: vi.fn(() => ({
    id: 'mission_1',
    title: 'Dispatch demo',
    assignments: [{ id: 'assign_1', workerId: 'dollycode', task: 'Demo\n\nSpec' }],
    _created: true,
  })),
  markMissionAssignmentDispatched: vi.fn(),
  recordMissionCheckpoint: vi.fn(() => null),
}))
vi.mock('../../server/swarm-memory', () => ({ appendSwarmMemoryEvent: vi.fn(), buildSwarmStartupSnapshot: vi.fn(() => '') }))
vi.mock('../../server/swarm-roster', () => ({ rosterByWorkerId: vi.fn(() => new Map()) }))
vi.mock('../../server/swarm-notifications', () => ({ publishSwarmCheckpointNotification: vi.fn() }))
vi.mock('../../server/swarm-chat-reader', () => ({ readWorkerMessages: vi.fn(() => []) }))
vi.mock('../../server/swarm-checkpoints', () => ({ newestCheckpointFromMessages: vi.fn(() => null) }))
vi.mock('../../server/swarm-kanban-canonical', () => ({
  ACCEPTANCE_FIELDS: ['accepted_by', 'accepted_at', 'lane', 'scope_understood', 'first_action', 'expected_artifact', 'risk_level', 'will_not_do'],
  appendCanonicalComment: vi.fn(),
  appendCanonicalEvent: vi.fn(),
  createMutationId: vi.fn(() => 'mx_dispatch_1'),
  findTaskAcceptance: vi.fn(),
  loadCanonicalTask: vi.fn(),
  parseAcceptanceMetadata: vi.fn((value: unknown) => value),
  writeTaskAcceptance: vi.fn(),
}))
vi.mock('../../server/kanban-assignees', () => ({
  getAssigneeDispatchSupport: vi.fn(),
  getAssigneeTaskScopeSupport: vi.fn(),
  readHermesConfig: vi.fn(() => ({ tasks: { human_reviewer: 'reviewer' } })),
}))
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    existsSync: vi.fn((target: string) => target.includes('/profiles/dollycode') || target.includes('/.local/bin/')),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
  }
})
vi.mock('node:child_process', () => ({
  execFile: vi.fn((cmd, args, optsOrCb, maybeCb) => {
    const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb
    cb?.(null, 'ok', '')
    return { on: vi.fn() }
  }),
}))

type RouteWithHandlers = typeof Route & {
  options: {
    server: {
      handlers: {
        POST: (ctx: { request: Request }) => Promise<Response>
      }
    }
  }
}

const handlers = (Route as RouteWithHandlers).options.server.handlers

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(isAuthenticated).mockReturnValue(true)
  vi.mocked(readHermesConfig).mockReturnValue({ tasks: { human_reviewer: 'reviewer' } })
  vi.mocked(getAssigneeDispatchSupport).mockReturnValue({
    dispatchSupported: true,
    dispatchReason: null,
  })
  vi.mocked(getAssigneeTaskScopeSupport).mockReturnValue({
    allowed: true,
    reason: null,
  })
  vi.mocked(rosterByWorkerId).mockReturnValue(new Map())
  vi.mocked(loadCanonicalTask).mockReturnValue({
    dbPath: '/tmp/kanban.db',
    task: { id: 't_demo', title: 'Demo', body: 'Spec', assignee: 'dollycode', status: 'ready' },
  })
})

describe('/api/swarm-dispatch task-bound policy', () => {
  it('fails dispatch without taskId for task-bound matrix requests', async () => {
    const res = await handlers.POST({
      request: new Request('http://localhost/api/swarm-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: 'mission-control', reason: 'Matrix request' }),
      }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'dispatch without taskId fails' })
  })

  it('rejects unsupported canonical assignees before writing dispatch receipts', async () => {
    vi.mocked(loadCanonicalTask).mockReturnValue({
      dbPath: '/tmp/kanban.db',
      task: { id: 't_demo', title: 'Demo', body: 'Spec', assignee: 'workspace', status: 'ready' },
    })
    vi.mocked(getAssigneeDispatchSupport).mockReturnValue({
      dispatchSupported: false,
      dispatchReason: 'Profile "workspace" has no configured model, so Matrix cannot dispatch it as a Kanban worker.',
    })

    const res = await handlers.POST({
      request: new Request('http://localhost/api/swarm-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: 't_demo',
          board: 'mission-control',
          reason: 'Matrix request',
          waitForCheckpoint: false,
          allowAsync: true,
        }),
      }),
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Unsupported canonical assignee "workspace": Profile "workspace" has no configured model, so Matrix cannot dispatch it as a Kanban worker.',
    })
    expect(createOrUpdateMission).not.toHaveBeenCalled()
    expect(appendCanonicalComment).not.toHaveBeenCalled()
    expect(appendCanonicalEvent).not.toHaveBeenCalled()
  })

  it('rejects numeric swarm assignees for PM/spec/routing task scope before dispatch', async () => {
    vi.mocked(loadCanonicalTask).mockReturnValue({
      dbPath: '/tmp/kanban.db',
      task: {
        id: 't_demo',
        title: 'Synthesize kickoff research and route next phase',
        body: 'Update PROJECT_BRIEF.md and TASKS.md with the governance decision.',
        assignee: 'swarm3',
        status: 'ready',
      },
    })
    vi.mocked(getAssigneeTaskScopeSupport).mockReturnValue({
      allowed: false,
      reason: 'Assignee "swarm3" cannot own PM/spec/governance/next-phase routing work from The Matrix. Route this task to a named durable owner such as default, dollydesign, dollyops, dollyresearch, dollyqa, or dollycode instead.',
    })

    const res = await handlers.POST({
      request: new Request('http://localhost/api/swarm-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: 't_demo',
          board: 'mission-control',
          reason: 'Matrix request',
          waitForCheckpoint: false,
          allowAsync: true,
        }),
      }),
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'Assignee "swarm3" cannot own PM/spec/governance/next-phase routing work from The Matrix. Route this task to a named durable owner such as default, dollydesign, dollyops, dollyresearch, dollyqa, or dollycode instead.',
    })
    expect(createOrUpdateMission).not.toHaveBeenCalled()
    expect(appendCanonicalComment).not.toHaveBeenCalled()
    expect(appendCanonicalEvent).not.toHaveBeenCalled()
  })

  it('allows task-bound dispatch before specialist acceptance and keeps request acceptance non-canonical', async () => {
    vi.mocked(findTaskAcceptance).mockReturnValue(null)

    const res = await handlers.POST({
      request: new Request('http://localhost/api/swarm-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: 't_demo',
          board: 'mission-control',
          reason: 'Matrix request',
          waitForCheckpoint: false,
          allowAsync: true,
          acceptance: {
            accepted_by: 'controller-browser',
            accepted_at: '2026-05-10T00:00:00Z',
          },
        }),
      }),
    })
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(createOrUpdateMission).toHaveBeenCalled()
    expect(appendCanonicalComment).toHaveBeenCalled()
    expect(appendCanonicalEvent).toHaveBeenCalled()
    expect(writeTaskAcceptance).not.toHaveBeenCalled()
    expect(payload.receipt).toMatchObject({
      taskId: 't_demo',
      missionId: 'mission_1',
      assignmentId: 'assign_1',
      workerId: 'dollycode',
      state: 'queued',
      acceptancePending: false,
      acceptanceRecorded: false,
    })
  })

  it('reports claimed-spawned with acceptance pending until canonical worker acceptance exists', async () => {
    vi.mocked(loadCanonicalTask)
      .mockReturnValueOnce({
        dbPath: '/tmp/kanban.db',
        task: { id: 't_demo', title: 'Demo', body: 'Spec', assignee: 'dollycode', status: 'ready' },
      })
      .mockReturnValueOnce({
        dbPath: '/tmp/kanban.db',
        task: {
          id: 't_demo',
          title: 'Demo',
          body: 'Spec',
          assignee: 'dollycode',
          status: 'running',
          current_run_id: 42,
          started_at: 1715299200,
        },
      })
    vi.mocked(findTaskAcceptance).mockReturnValue(null)

    const res = await handlers.POST({
      request: new Request('http://localhost/api/swarm-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: 't_demo',
          board: 'mission-control',
          reason: 'Matrix request',
          waitForCheckpoint: false,
          allowAsync: true,
        }),
      }),
    })
    const payload = await res.json()

    expect(res.status).toBe(200)
    expect(payload.receipt).toMatchObject({
      taskId: 't_demo',
      state: 'claimed-spawned',
      acceptancePending: true,
      acceptanceRecorded: false,
      stateAfter: 'running',
    })
    expect(appendCanonicalEvent).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'matrix_dispatch_receipt',
      payload: expect.objectContaining({
        state: 'claimed-spawned',
        acceptancePending: true,
        stateAfter: 'running',
      }),
    }))
  })
})