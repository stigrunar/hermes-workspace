import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getMatrixAttentionSnapshot } from '../../server/swarm-kanban-attention'

export const Route = createFileRoute('/api/swarm-attention' as never)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const limit = Number(url.searchParams.get('limit') ?? 8)
        return json({ ok: true, ...getMatrixAttentionSnapshot(Number.isFinite(limit) ? limit : 8) })
      },
    },
  },
})
