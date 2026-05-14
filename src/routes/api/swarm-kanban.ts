import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { getKanbanBackendMeta } from '../../server/kanban-backend'
import { isAuthenticated } from '../../server/auth-middleware'
import { querySwarmKanbanBoard } from '../../server/swarm-kanban-query'

const LEGACY_MUTATION_ERROR = 'The Matrix is the control plane for Kanban mutations. Use /api/swarm-kanban-control for create/edit/assign/ready/block/comment/link actions, /api/swarm-dispatch for worker claim/spawn, and worker kanban_complete for done.'

function rejectLegacyMutation(): Response {
  return json({ ok: false, error: LEGACY_MUTATION_ERROR, backend: getKanbanBackendMeta() }, { status: 409 })
}

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
          shippingGovernor: result.shippingGovernor,
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
        return rejectLegacyMutation()
      },
      PATCH: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        return rejectLegacyMutation()
      },
    },
  },
})
