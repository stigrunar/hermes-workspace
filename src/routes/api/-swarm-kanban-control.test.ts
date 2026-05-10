import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import { applyMatrixKanbanControl } from '../../server/swarm-kanban-control'
import { Route } from './swarm-kanban-control'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/swarm-kanban-control', () => ({
  applyMatrixKanbanControl: vi.fn(),
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
})

describe('/api/swarm-kanban-control', () => {
  it('returns 401 for unauthenticated requests', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)

    const res = await handlers.POST({
      request: new Request('http://localhost/api/swarm-kanban-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_ready', taskId: 't_demo' }),
      }),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, error: 'Unauthorized' })
    expect(applyMatrixKanbanControl).not.toHaveBeenCalled()
  })

  it('returns 409 receipts for policy conflicts', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(applyMatrixKanbanControl).mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Direct running status is not allowed from The Matrix.',
    })

    const res = await handlers.POST({
      request: new Request('http://localhost/api/swarm-kanban-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_task', title: 'Nope', status: 'running' }),
      }),
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ ok: false, error: 'Direct running status is not allowed from The Matrix.' })
  })

  it('returns explicit receipts for allowed safe actions', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(applyMatrixKanbanControl).mockResolvedValue({
      ok: true,
      receipt: {
        mutationId: 'mx_123',
        action: 'mark_ready',
        taskId: 't_demo',
        board: 'mission-control',
        actor: 'matrix',
        status: 'ready',
        assignee: 'dollycode',
        audit: { commentWritten: true, eventWritten: true },
      },
    })

    const res = await handlers.POST({
      request: new Request('http://localhost/api/swarm-kanban-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_ready', taskId: 't_demo', board: 'mission-control' }),
      }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      receipt: {
        mutationId: 'mx_123',
        action: 'mark_ready',
        taskId: 't_demo',
        status: 'ready',
      },
    })
  })
})
