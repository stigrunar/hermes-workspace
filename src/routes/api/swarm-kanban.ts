import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import { createKanbanCard, getKanbanBackendMeta, updateKanbanCard } from '../../server/kanban-backend'
import { isAuthenticated } from '../../server/auth-middleware'
import { querySwarmKanbanBoard } from '../../server/swarm-kanban-query'

const CreateCardSchema = z.object({
  title: z.string().trim().min(1).max(200),
  spec: z.string().trim().max(5000).optional().default(''),
  acceptanceCriteria: z.string().trim().max(5000).optional().default(''),
  assignedWorker: z.string().trim().max(120).optional().nullable(),
  reviewer: z.string().trim().max(120).optional().nullable(),
  status: z.enum(['backlog', 'ready', 'running', 'review', 'blocked', 'done']).optional().default('backlog'),
  missionId: z.string().trim().max(200).optional().nullable(),
  reportPath: z.string().trim().max(500).optional().nullable(),
  createdBy: z.string().trim().max(120).optional().default('aurora'),
})

const UpdateCardSchema = CreateCardSchema.partial().extend({
  id: z.string().trim().min(1),
})

export const Route = createFileRoute('/api/swarm-kanban' as never)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const board = url.searchParams.get('board')
        const taskId = url.searchParams.get('taskId')
        const result = await querySwarmKanbanBoard({ board, taskId })
        return json({
          ok: true,
          cards: result.cards,
          backend: result.backend,
          boards: result.boards,
          selectedBoard: result.selectedBoard,
          readOnly: result.readOnly,
          taskDetail: result.taskDetail,
        })
      },
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
        const parsed = CreateCardSchema.safeParse(body)
        if (!parsed.success) {
          return json({ ok: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') }, { status: 400 })
        }
        const card = await createKanbanCard({
          title: parsed.data.title,
          spec: parsed.data.spec,
          acceptanceCriteria: parsed.data.acceptanceCriteria
            ? parsed.data.acceptanceCriteria
                .split('\n')
                .map((line) => line.replace(/^[-*]\s*/, '').trim())
                .filter(Boolean)
            : [],
          assignedWorker: parsed.data.assignedWorker,
          reviewer: parsed.data.reviewer,
          status: parsed.data.status,
          missionId: parsed.data.missionId,
          reportPath: parsed.data.reportPath,
          createdBy: parsed.data.createdBy,
        })
        return json({ ok: true, card, backend: getKanbanBackendMeta() })
      },
      PATCH: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
        }
        const parsed = UpdateCardSchema.safeParse(body)
        if (!parsed.success) {
          return json({ ok: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') }, { status: 400 })
        }
        const { id, ...updates } = parsed.data
        const card = await updateKanbanCard(id, {
          title: updates.title,
          spec: updates.spec,
          acceptanceCriteria: updates.acceptanceCriteria
            ? updates.acceptanceCriteria
                .split('\n')
                .map((line) => line.replace(/^[-*]\s*/, '').trim())
                .filter(Boolean)
            : undefined,
          assignedWorker: updates.assignedWorker,
          reviewer: updates.reviewer,
          status: updates.status,
          missionId: updates.missionId,
          reportPath: updates.reportPath,
        })
        if (!card) return json({ ok: false, error: 'Card not found' }, { status: 404 })
        return json({ ok: true, card, backend: getKanbanBackendMeta() })
      },
    },
  },
})
