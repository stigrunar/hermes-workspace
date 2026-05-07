import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import {
  createKanbanCard,
  getKanbanBackendMeta,
  listKanbanCards,
  updateKanbanCard,
} from '../../server/kanban-backend'
import { Route } from './swarm-kanban'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/kanban-backend', () => ({
  createKanbanCard: vi.fn(),
  getKanbanBackendMeta: vi.fn(() => ({ id: 'hermes-proxy', label: 'Hermes Dashboard' })),
  listKanbanCards: vi.fn(),
  updateKanbanCard: vi.fn(),
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
  vi.mocked(getKanbanBackendMeta).mockReturnValue({ id: 'hermes-proxy', label: 'Hermes Dashboard' })
})

describe('/api/swarm-kanban auth boundary', () => {
  it('returns 401 for unauthenticated GET requests', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)

    const res = await handlers.GET({
      request: new Request('http://localhost/api/swarm-kanban'),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, error: 'Unauthorized' })
    expect(listKanbanCards).not.toHaveBeenCalled()
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

  it('still serves cards for authenticated GET requests', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(listKanbanCards).mockResolvedValue([
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
      },
    ])

    const res = await handlers.GET({
      request: new Request('http://localhost/api/swarm-kanban'),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      backend: { id: 'hermes-proxy', label: 'Hermes Dashboard' },
      cards: [{ id: 't_demo', title: 'Demo', status: 'ready' }],
    })
  })
})
