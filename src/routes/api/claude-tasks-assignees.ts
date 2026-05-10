/**
 * Proxy endpoint — returns available task assignees.
 * Reads agent profiles from the Hermes Agent gateway and combines with the
 * configured human reviewer name (tasks.human_reviewer in config.yaml).
 * Falls back to profile directory listing if the gateway doesn't have
 * a /api/tasks/assignees endpoint.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { BEARER_TOKEN, CLAUDE_API, CLAUDE_DASHBOARD_URL } from '../../server/gateway-capabilities'
import {
  listKnownKanbanAssignees,
  readHermesConfig,
} from '../../server/kanban-assignees'

function authHeaders(): Record<string, string> {
  return BEARER_TOKEN ? { Authorization: `Bearer ${BEARER_TOKEN}` } : {}
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2000),
      headers: authHeaders(),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export const Route = createFileRoute('/api/claude-tasks-assignees')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
        }

        const config = readHermesConfig()
        const tasksConfig = (config.tasks ?? {}) as Record<string, unknown>
        const humanReviewer = (tasksConfig.human_reviewer as string) || null

        // Prefer the dashboard plugin endpoint: it is the source used by the
        // Hermes kanban CLI and includes ~/.hermes/profiles plus assignees
        // already present on the board.
        const remotePayload =
          await fetchJson(`${CLAUDE_DASHBOARD_URL}/api/plugins/kanban/assignees`) ??
          await fetchJson(`${CLAUDE_API}/api/tasks/assignees`)
        const allAssignees = listKnownKanbanAssignees({
          remotePayload,
          humanReviewer,
        })
        const assignees = allAssignees.filter((assignee) => assignee.dispatchSupported)
        const unsupportedAssignees = allAssignees.filter((assignee) => !assignee.dispatchSupported)

        return new Response(
          JSON.stringify({ assignees, unsupportedAssignees, humanReviewer }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      },
    },
  },
})
