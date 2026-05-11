import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import {
  createKanbanCard,
  getKanbanBackendMeta,
  updateKanbanCard,
} from '../../server/kanban-backend'
import { querySwarmKanbanBoard } from '../../server/swarm-kanban-query'
import { Route } from './swarm-kanban'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/kanban-backend', () => ({
  createKanbanCard: vi.fn(),
  getKanbanBackendMeta: vi.fn(() => BACKEND_META),
  updateKanbanCard: vi.fn(),
}))

vi.mock('../../server/swarm-kanban-query', () => ({
  querySwarmKanbanBoard: vi.fn(),
}))

const BACKEND_META = {
  id: 'hermes-proxy' as const,
  label: 'Hermes Dashboard',
  detected: true,
  writable: true,
  controlPlane: {
    owner: 'the-matrix' as const,
    role: 'control-plane' as const,
    nativeKanbanRole: 'execution-storage' as const,
    mutationEndpoint: '/api/swarm-kanban-control' as const,
    dispatchEndpoint: '/api/swarm-dispatch' as const,
    completionOwner: 'worker-kanban-complete' as const,
    storage: 'hermes-kanban' as const,
    execution: 'hermes-kanban-dispatcher' as const,
    legacyMutationEndpointWritable: false,
    warnings: [],
  },
}

type RouteWithHandlers = typeof Route & {
  options: {
    server: {
      handlers: {
        GET: (ctx: { request: Request }) => Promise<Response>
        POST: (ctx: { request: Request }) => Promise<Response>
        PATCH: (ctx: { request: Request }) => Promise<Response>
      }
    }
  }
}

const handlers = (Route as RouteWithHandlers).options.server.handlers

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getKanbanBackendMeta).mockReturnValue(BACKEND_META)
  vi.mocked(querySwarmKanbanBoard).mockResolvedValue({
    cards: [],
    backend: BACKEND_META,
    boards: [{ slug: 'mission-control', label: 'The Matrix', description: null, available: true, current: true, source: 'dashboard' }],
    selectedBoard: { requested: 'mission-control', slug: 'mission-control', label: 'The Matrix', description: null, fallback: false },
    readOnly: true,
    taskDetail: null,
  })
})

describe('/api/swarm-kanban auth boundary', () => {
  it('returns 401 for unauthenticated GET requests', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)

    const res = await handlers.GET({
      request: new Request('http://localhost/api/swarm-kanban'),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, error: 'Unauthorized' })
    expect(querySwarmKanbanBoard).not.toHaveBeenCalled()
  })

  it('returns 401 for unauthenticated POST requests before parsing input', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)

    const res = await handlers.POST({
      request: new Request('http://localhost/api/swarm-kanban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, error: 'Unauthorized' })
    expect(createKanbanCard).not.toHaveBeenCalled()
  })

  it('returns 401 for unauthenticated PATCH requests before parsing input', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)

    const res = await handlers.PATCH({
      request: new Request('http://localhost/api/swarm-kanban', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, error: 'Unauthorized' })
    expect(updateKanbanCard).not.toHaveBeenCalled()
  })

  it('serves board metadata and forwards selector params for authenticated GET requests', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(querySwarmKanbanBoard).mockResolvedValue({
      cards: [
        {
          id: 't_demo',
          title: 'Demo',
          spec: '',
          acceptanceCriteria: [],
          assignedWorker: null,
          reviewer: null,
          status: 'ready',
          missionId: null,
          reportPath: null,
          createdBy: 'tester',
          createdAt: 1,
          updatedAt: 1,
          boardSlug: 'mission-control',
          boardLabel: 'The Matrix',
          boardSource: 'dashboard',
          doneAudit: null,
        },
      ],
      backend: BACKEND_META,
      boards: [{ slug: 'mission-control', label: 'The Matrix', description: null, available: true, current: true, source: 'dashboard' }],
      selectedBoard: { requested: 'matrix', slug: 'mission-control', label: 'The Matrix', description: null, fallback: false },
      readOnly: true,
      taskDetail: { id: 't_demo', board: 'mission-control', title: 'Demo', status: 'ready', lane: 'ready', assignee: null, createdBy: 'tester', body: '', result: null, workspaceKind: null, workspacePath: '/tmp/work', currentRunId: null, createdAt: 1, startedAt: null, completedAt: null, comments: [], recentRuns: [], doneAudit: null },
    })

    const res = await handlers.GET({
      request: new Request('http://localhost/api/swarm-kanban?board=matrix&taskId=t_demo'),
    })

    expect(querySwarmKanbanBoard).toHaveBeenCalledWith({ board: 'matrix', taskId: 't_demo' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      readOnly: true,
      backend: BACKEND_META,
      selectedBoard: { slug: 'mission-control', label: 'The Matrix' },
      cards: [{ id: 't_demo', title: 'Demo', status: 'ready' }],
      taskDetail: { id: 't_demo', workspacePath: '/tmp/work' },
    })
  })

  it('rejects legacy direct POST mutations so Matrix remains the control plane', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)

    const res = await handlers.POST({
      request: new Request('http://localhost/api/swarm-kanban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Done shortcut', status: 'done' }),
      }),
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ ok: false, error: expect.stringContaining('The Matrix is the control plane'), backend: { controlPlane: { mutationEndpoint: '/api/swarm-kanban-control' } } })
    expect(createKanbanCard).not.toHaveBeenCalled()
  })

  it('rejects legacy direct PATCH mutations so Matrix remains the control plane', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)

    const res = await handlers.PATCH({
      request: new Request('http://localhost/api/swarm-kanban', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 't_demo', status: 'done' }),
      }),
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ ok: false, error: expect.stringContaining('/api/swarm-kanban-control'), backend: { controlPlane: { legacyMutationEndpointWritable: false } } })
    expect(updateKanbanCard).not.toHaveBeenCalled()
  })
})
