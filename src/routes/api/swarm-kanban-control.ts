import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import { isAuthenticated } from '../../server/auth-middleware'
import { applyMatrixKanbanControl } from '../../server/swarm-kanban-control'

const ControlSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create_task'),
    board: z.string().trim().max(120).optional().nullable(),
    actor: z.string().trim().max(120).optional().nullable(),
    reason: z.string().trim().max(1000).optional().nullable(),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().max(10000).optional().nullable(),
    assignedWorker: z.string().trim().max(120).optional().nullable(),
    status: z.enum(['backlog', 'ready', 'blocked', 'running', 'review', 'done']).optional().nullable(),
  }),
  z.object({
    action: z.literal('edit_task'),
    board: z.string().trim().max(120).optional().nullable(),
    actor: z.string().trim().max(120).optional().nullable(),
    reason: z.string().trim().max(1000).optional().nullable(),
    taskId: z.string().trim().min(1),
    title: z.string().trim().max(200).optional().nullable(),
    body: z.string().trim().max(10000).optional().nullable(),
  }),
  z.object({
    action: z.literal('assign_task'),
    board: z.string().trim().max(120).optional().nullable(),
    actor: z.string().trim().max(120).optional().nullable(),
    reason: z.string().trim().max(1000).optional().nullable(),
    taskId: z.string().trim().min(1),
    assignedWorker: z.string().trim().max(120).optional().nullable(),
  }),
  z.object({
    action: z.literal('mark_ready'),
    board: z.string().trim().max(120).optional().nullable(),
    actor: z.string().trim().max(120).optional().nullable(),
    reason: z.string().trim().max(1000).optional().nullable(),
    taskId: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal('mark_blocked'),
    board: z.string().trim().max(120).optional().nullable(),
    actor: z.string().trim().max(120).optional().nullable(),
    reason: z.string().trim().max(1000).optional().nullable(),
    taskId: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal('add_comment'),
    board: z.string().trim().max(120).optional().nullable(),
    actor: z.string().trim().max(120).optional().nullable(),
    reason: z.string().trim().max(1000).optional().nullable(),
    taskId: z.string().trim().min(1),
    comment: z.string().trim().min(1).max(5000),
  }),
  z.object({
    action: z.literal('link_parent'),
    board: z.string().trim().max(120).optional().nullable(),
    actor: z.string().trim().max(120).optional().nullable(),
    reason: z.string().trim().max(1000).optional().nullable(),
    taskId: z.string().trim().min(1),
    parentTaskId: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal('reclaim_worker'),
    board: z.string().trim().max(120).optional().nullable(),
    actor: z.string().trim().max(120).optional().nullable(),
    reason: z.string().trim().max(1000).min(1),
    taskId: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal('reassign_worker'),
    board: z.string().trim().max(120).optional().nullable(),
    actor: z.string().trim().max(120).optional().nullable(),
    reason: z.string().trim().max(1000).min(1),
    taskId: z.string().trim().min(1),
    assignedWorker: z.string().trim().min(1).max(120),
  }),
])

export const Route = createFileRoute('/api/swarm-kanban-control' as never)({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
        }
        const parsed = ControlSchema.safeParse(body)
        if (!parsed.success) {
          return json({ ok: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') }, { status: 400 })
        }
        const result = await applyMatrixKanbanControl(parsed.data as Parameters<typeof applyMatrixKanbanControl>[0])
        if (!result.ok) {
          const failure = result as Extract<Awaited<typeof result>, { ok: false }>
          return json({ ok: false, error: failure.error }, { status: failure.status })
        }
        return json({ ok: true, receipt: result.receipt })
      },
    },
  },
})
