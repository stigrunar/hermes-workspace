import { describe, expect, it, vi } from 'vitest'

async function loadQueryModule() {
  vi.resetModules()

  const fetchDashboardKanbanBoard = vi.fn(async (board?: string) => ({
    columns: [
      {
        name: 'ready',
        tasks: [
          {
            id: board === 'mission-control' ? 't_matrix' : 't_default',
            title: board === 'mission-control' ? 'Matrix task' : 'Default task',
            body: '',
            assignee: null,
            status: 'ready',
            created_by: 'tester',
            created_at: board === 'mission-control' ? 20 : 10,
          },
        ],
      },
    ],
  }))
  const fetchDashboardKanbanTask = vi.fn(async (taskId: string, board?: string) => ({
    id: taskId,
    title: 'Selected task',
    body: '',
    assignee: null,
    status: 'ready',
    created_by: 'tester',
    created_at: 20,
    workspace_path: `/tmp/${board}/${taskId}`,
  }))
  const listDashboardKanbanBoards = vi.fn(async () => ({
    current: 'mission-control',
    boards: [
      { slug: 'default', display_name: 'Root board' },
      { slug: 'mission-control', display_name: 'Mission Control' },
    ],
  }))

  vi.doMock('./gateway-capabilities', () => ({
    getCapabilities: vi.fn(() => ({ kanban: true })),
  }))
  vi.doMock('./kanban-backend', () => ({
    getKanbanBackendMeta: vi.fn(() => ({ id: 'hermes-proxy', label: 'Hermes Dashboard', detected: true, writable: false })),
  }))
  vi.doMock('./kanban-dashboard-proxy', () => ({
    fetchDashboardKanbanBoard,
    fetchDashboardKanbanTask,
    listDashboardKanbanBoards,
  }))
  vi.doMock('./swarm-kanban-store', () => ({
    SWARM_KANBAN_FILE: '/tmp/swarm2-kanban.json',
    listSwarmKanbanCards: vi.fn(() => []),
  }))

  const mod = await import('./swarm-kanban-query')
  return { mod, fetchDashboardKanbanBoard, fetchDashboardKanbanTask, listDashboardKanbanBoards }
}

describe('querySwarmKanbanBoard aggregate boards', () => {
  it('returns all dashboard board cards with board metadata first-class on each card', async () => {
    const { mod, fetchDashboardKanbanBoard } = await loadQueryModule()

    const result = await mod.querySwarmKanbanBoard({ board: 'all' })

    expect(result.readOnly).toBe(true)
    expect(result.selectedBoard).toMatchObject({ slug: 'all', label: 'All boards', fallback: false })
    expect(result.boards.map((board) => board.slug)).toEqual(['all', 'default', 'mission-control'])
    expect(fetchDashboardKanbanBoard).toHaveBeenCalledWith('default')
    expect(fetchDashboardKanbanBoard).toHaveBeenCalledWith('mission-control')
    expect(result.cards).toEqual([
      expect.objectContaining({
        id: 't_matrix',
        title: 'Matrix task',
        boardSlug: 'mission-control',
        boardLabel: 'The Matrix',
        boardSource: 'dashboard',
      }),
      expect.objectContaining({
        id: 't_default',
        title: 'Default task',
        boardSlug: 'default',
        boardLabel: 'Root board',
        boardSource: 'dashboard',
      }),
    ])
  })

  it('resolves aggregate task detail through the card origin board', async () => {
    const { mod, fetchDashboardKanbanTask } = await loadQueryModule()

    const result = await mod.querySwarmKanbanBoard({ board: 'all', taskId: 't_matrix' })

    expect(fetchDashboardKanbanTask).toHaveBeenCalledWith('t_matrix', 'mission-control')
    expect(result.taskDetail).toMatchObject({
      id: 't_matrix',
      board: 'mission-control',
      workspacePath: '/tmp/mission-control/t_matrix',
    })
  })

  it('keeps single-board requests scoped to the requested board', async () => {
    const { mod, fetchDashboardKanbanBoard } = await loadQueryModule()

    const result = await mod.querySwarmKanbanBoard({ board: 'mission-control' })

    expect(fetchDashboardKanbanBoard).toHaveBeenCalledTimes(1)
    expect(fetchDashboardKanbanBoard).toHaveBeenCalledWith('mission-control')
    expect(result.selectedBoard).toMatchObject({ slug: 'mission-control', label: 'The Matrix' })
    expect(result.cards).toEqual([
      expect.objectContaining({
        id: 't_matrix',
        boardSlug: 'mission-control',
        boardLabel: 'The Matrix',
      }),
    ])
  })
})
