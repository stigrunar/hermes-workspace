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
  getKanbanBackendMeta: vi.fn(() => ({ id: 'hermes-proxy', label: 'Hermes Dashboard', detected: true, writable: true })),
  updateKanbanCard: vi.fn(),
}))

vi.mock('../../server/swarm-kanban-query', () => ({
  querySwarmKanbanBoard: vi.fn(),
}))

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
  vi.mocked(getKanbanBackendMeta).mockReturnValue({ id: 'hermes-proxy', label: 'Hermes Dashboard', detected: true, writable: true })
  vi.mocked(querySwarmKanbanBoard).mockResolvedValue({
    cards: [],
    backend: { id: 'hermes-proxy', label: 'Hermes Dashboard', detected: true, writable: true },
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
        },
      ],
      backend: { id: 'hermes-proxy', label: 'Hermes Dashboard', detected: true, writable: true },
      boards: [{ slug: 'mission-control', label: 'The Matrix', description: null, available: true, current: true, source: 'dashboard' }],
      selectedBoard: { requested: 'matrix', slug: 'mission-control', label: 'The Matrix', description: null, fallback: false },
      readOnly: true,
      taskDetail: { id: 't_demo', board: 'mission-control', title: 'Demo', status: 'ready', lane: 'ready', assignee: null, createdBy: 'tester', body: '', result: null, workspaceKind: null, workspacePath: '/tmp/work', currentRunId: null, createdAt: 1, startedAt: null, completedAt: null, comments: [], recentRuns: [] },
    })

    const res = await handlers.GET({
      request: new Request('http://localhost/api/swarm-kanban?board=matrix&taskId=t_demo'),
    })

    expect(querySwarmKanbanBoard).toHaveBeenCalledWith({ board: 'matrix', taskId: 't_demo' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      readOnly: true,
      backend: { id: 'hermes-proxy', label: 'Hermes Dashboard', detected: true, writable: true },
      selectedBoard: { slug: 'mission-control', label: 'The Matrix' },
      cards: [{ id: 't_demo', title: 'Demo', status: 'ready' }],
      taskDetail: { id: 't_demo', workspacePath: '/tmp/work' },
    })
  })
})
