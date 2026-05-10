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

async function loadSqliteQueryModule() {
  vi.resetModules()

  const missionControlDb = '/tmp/hermes/kanban/boards/mission-control/kanban.db'
  const execFileSync = vi.fn((command: string, args?: ReadonlyArray<string>) => {
    expect(command).toBe('sqlite3')
    const [dbPath, format, sql] = args ?? []
    expect(format).toBe('-json')

    if (dbPath === missionControlDb && sql?.includes("select id, title, body, assignee, status, created_by, created_at, started_at, completed_at")) {
      return JSON.stringify([
        {
          id: 't_done_parent',
          title: 'Done parent',
          body: 'Scoped slice landed',
          assignee: 'dollycode',
          status: 'done',
          created_by: 'tester',
          created_at: 100,
          started_at: 110,
          completed_at: 120,
          workspace_kind: 'dir',
          workspace_path: '/tmp/work',
          current_run_id: 7,
          result: 'shipped',
        },
      ])
    }

    if (dbPath === missionControlDb && sql?.includes("where p.id = 't_done_parent' and p.status = 'done'")) {
      return JSON.stringify([
        {
          task_id: 't_done_parent',
          open_children: 't_child\u001fFollow-up task\u001fblocked\u001fswarm7',
          open_child_count: 1,
          completed_event_count: 0,
          completed_run_count: 0,
        },
      ])
    }

    if (dbPath === missionControlDb && sql?.includes("where p.status = 'done'")) {
      return JSON.stringify([
        {
          task_id: 't_done_parent',
          open_children: 't_child\u001fFollow-up task\u001fblocked\u001fswarm7',
          open_child_count: 1,
          completed_event_count: 1,
          completed_run_count: 0,
        },
      ])
    }

    if (dbPath === missionControlDb && sql?.includes("where id = 't_done_parent'")) {
      return JSON.stringify([
        {
          id: 't_done_parent',
          title: 'Done parent',
          body: 'Scoped slice landed',
          assignee: 'dollycode',
          status: 'done',
          created_by: 'tester',
          created_at: 100,
          started_at: 110,
          completed_at: 120,
          workspace_kind: 'dir',
          workspace_path: '/tmp/work',
          current_run_id: 7,
          result: 'shipped',
        },
      ])
    }

    if (dbPath === missionControlDb && sql?.includes("where task_id = 't_done_parent' and kind in ('specialist_accepted', 'accepted')")) {
      return JSON.stringify([])
    }

    if (dbPath === missionControlDb && sql?.includes("where task_id = 't_done_parent' and kind in ('matrix_control', 'matrix_dispatch_receipt')")) {
      return JSON.stringify([
        {
          kind: 'matrix_dispatch_receipt',
          payload: JSON.stringify({
            mutationId: 'mx_dispatch_1',
            taskId: 't_done_parent',
            missionId: 'mission_1',
            assignmentId: 'assign_1',
            workerId: 'dollycode',
            delivery: 'tmux',
            ok: true,
            state: 'claimed-spawned',
            acceptancePending: true,
            checkpointStatus: 'not-requested',
            stateAfter: 'running',
          }),
          created_at: 130,
        },
      ])
    }

    if (dbPath === missionControlDb && sql?.includes('from task_comments')) {
      return JSON.stringify([{ author: 'dollycode', body: 'accepted', created_at: 125 }])
    }

    if (dbPath === missionControlDb && sql?.includes('from task_runs')) {
      return JSON.stringify([{ id: 7, status: 'completed', outcome: 'completed', summary: 'slice done', metadata: '{"tests":2}', error: null, started_at: 110, ended_at: 120 }])
    }

    throw new Error(`Unexpected sqlite query for ${dbPath}: ${sql}`)
  })

  vi.doMock('node:child_process', () => ({ execFileSync }))
  vi.doMock('node:fs', () => ({
    existsSync: vi.fn((target: string) => target === '/tmp/hermes/kanban/boards' || target === missionControlDb),
    readdirSync: vi.fn(() => [{ name: 'mission-control', isDirectory: () => true }]),
  }))
  vi.doMock('./claude-paths', () => ({
    getClaudeRoot: vi.fn(() => '/tmp/hermes'),
  }))
  vi.doMock('./gateway-capabilities', () => ({
    getCapabilities: vi.fn(() => ({ kanban: false })),
  }))
  vi.doMock('./kanban-backend', () => ({
    getKanbanBackendMeta: vi.fn(() => ({ id: 'sqlite', label: 'Hermes SQLite', detected: true, writable: false })),
  }))
  vi.doMock('./kanban-dashboard-proxy', () => ({
    fetchDashboardKanbanBoard: vi.fn(),
    fetchDashboardKanbanTask: vi.fn(),
    listDashboardKanbanBoards: vi.fn(),
  }))
  vi.doMock('./swarm-kanban-store', () => ({
    SWARM_KANBAN_FILE: '/tmp/swarm2-kanban.json',
    listSwarmKanbanCards: vi.fn(() => []),
  }))

  const mod = await import('./swarm-kanban-query')
  return { mod, execFileSync }
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

describe('querySwarmKanbanBoard done audit', () => {
  it('surfaces follow-up visibility on done sqlite cards', async () => {
    const { mod, execFileSync } = await loadSqliteQueryModule()

    const result = await mod.querySwarmKanbanBoard({ board: 'mission-control' })

    expect(execFileSync).toHaveBeenCalled()
    expect(result.cards).toEqual([
      expect.objectContaining({
        id: 't_done_parent',
        status: 'done',
        boardSlug: 'mission-control',
        boardLabel: 'The Matrix',
        doneAudit: expect.objectContaining({
          openChildCount: 1,
          completedEventCount: 1,
          completedRunCount: 0,
          openChildren: [
            expect.objectContaining({
              id: 't_child',
              title: 'Follow-up task',
              status: 'blocked',
              assignee: 'swarm7',
            }),
          ],
          warnings: [expect.stringContaining('Slice done; 1 linked follow-up task still open/blocked.')],
        }),
      }),
    ])
  })

  it('includes done audit warnings in sqlite task detail when evidence is missing', async () => {
    const { mod } = await loadSqliteQueryModule()

    const result = await mod.getSwarmKanbanTaskDetail({ board: 'mission-control', taskId: 't_done_parent' })

    expect(result).toMatchObject({
      id: 't_done_parent',
      board: 'mission-control',
      status: 'done',
      doneAudit: {
        openChildCount: 1,
        completedEventCount: 0,
        completedRunCount: 0,
        warnings: [
          'Slice done; 1 linked follow-up task still open/blocked.',
          'Done has no completed run/event evidence exposed by the canonical Kanban DB.',
        ],
      },
    })
  })

  it('includes dispatch receipt lifecycle fields so UI can show acceptance pending after claim', async () => {
    const { mod } = await loadSqliteQueryModule()

    const result = await mod.getSwarmKanbanTaskDetail({ board: 'mission-control', taskId: 't_done_parent' })

    expect(result?.controlReceipts[0]).toMatchObject({
      kind: 'matrix_dispatch_receipt',
      state: 'claimed-spawned',
      acceptancePending: true,
      stateAfter: 'running',
      workerId: 'dollycode',
    })
  })
})
