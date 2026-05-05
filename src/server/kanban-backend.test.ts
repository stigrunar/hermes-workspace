import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

async function loadKanbanBackend(options?: {
  existsSync?: (path: string) => boolean
  execFileSync?: (command: string, args?: string[]) => string
}) {
  vi.doMock('./swarm-kanban-store', () => ({
    SWARM_KANBAN_FILE: '/tmp/swarm2-kanban.json',
    createSwarmKanbanCard: vi.fn((input) => ({
      id: 'local-1',
      title: input.title,
      spec: input.spec ?? '',
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      assignedWorker: input.assignedWorker ?? null,
      reviewer: input.reviewer ?? null,
      status: input.status ?? 'backlog',
      missionId: input.missionId ?? null,
      reportPath: input.reportPath ?? null,
      createdBy: input.createdBy ?? 'swarm2-kanban',
      createdAt: 1,
      updatedAt: 1,
    })),
    listSwarmKanbanCards: vi.fn(() => [{
      id: 'local-1',
      title: 'Local task',
      spec: '',
      acceptanceCriteria: [],
      assignedWorker: null,
      reviewer: null,
      status: 'backlog',
      missionId: null,
      reportPath: null,
      createdBy: 'local',
      createdAt: 1,
      updatedAt: 1,
    }]),
    updateSwarmKanbanCard: vi.fn((cardId, updates) => ({
      id: cardId,
      title: updates.title ?? 'Local task',
      spec: updates.spec ?? '',
      acceptanceCriteria: [],
      assignedWorker: updates.assignedWorker ?? null,
      reviewer: null,
      status: updates.status ?? 'backlog',
      missionId: null,
      reportPath: null,
      createdBy: 'local',
      createdAt: 1,
      updatedAt: 2,
    })),
  }))

  vi.doMock('node:fs', () => ({
    existsSync: vi.fn((path: string) => options?.existsSync?.(path) ?? false),
  }))

  vi.doMock('node:child_process', () => ({
    execFileSync: vi.fn((command: string, args?: string[]) => options?.execFileSync?.(command, args) ?? ''),
  }))

  return import('./kanban-backend')
}

describe('kanban-backend', () => {
  it('auto-detect prefers Hermes backend when Hermes CLI and canonical storage are present', async () => {
    vi.stubEnv('CLAUDE_HOME', '/home/openclaw/.hermes/profiles/swarm2')
    const sqliteCalls: Array<{ command: string; args?: string[] }> = []
    const mod = await loadKanbanBackend({
      existsSync: (target) => target === '/home/openclaw/.hermes/kanban.db' || target === '/home/openclaw/.hermes/kanban',
      execFileSync: (command, args = []) => {
        if (command === 'which' && args[0] === 'claude') return '/Users/aurora/.local/bin/claude\n'
        if (command === '/Users/aurora/.local/bin/claude' && args[0] === '--version') return 'claude 1.0.0\n'
        if (command === 'sqlite3') {
          sqliteCalls.push({ command, args })
          return JSON.stringify([
            {
              id: 't_12345678',
              title: 'Hermes task',
              body: 'Backed by sqlite',
              status: 'running',
              assignee: 'swarm2',
              created_at: 1777527540,
              updated_at: 1777527644,
            },
          ])
        }
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
      },
    })

    expect(mod.getKanbanBackendMeta()).toMatchObject({
      id: 'claude',
      detected: true,
      writable: true,
      path: '/home/openclaw/.hermes/kanban.db',
      canonicalPath: '/home/openclaw/.hermes/kanban.db',
      isCanonical: true,
    })

    const cards = mod.listKanbanCards()
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      id: 't_12345678',
      title: 'Hermes task',
      status: 'running',
      assignedWorker: 'swarm2',
      createdBy: 'claude-kanban',
    })
    expect(sqliteCalls[0]?.args?.[0]).toBe('/home/openclaw/.hermes/kanban.db')
  })

  it('auto-detect uses Hermes storage directly when the CLI is unavailable', async () => {
    vi.stubEnv('CLAUDE_HOME', '/home/openclaw/.hermes/profiles/swarm2')
    const mod = await loadKanbanBackend({
      existsSync: (target) => target === '/home/openclaw/.hermes/kanban.db',
      execFileSync: (command, args = []) => {
        if (command === 'which' && args[0] === 'claude') throw new Error('not found')
        if (command === 'sqlite3') {
          return JSON.stringify([
            {
              id: 't_direct',
              title: 'Direct Hermes task',
              body: '',
              status: 'ready',
              assignee: null,
              created_at: 1777527540,
              updated_at: 1777527644,
            },
          ])
        }
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
      },
    })

    expect(mod.getKanbanBackendMeta()).toMatchObject({
      id: 'claude',
      detected: true,
      writable: true,
      path: '/home/openclaw/.hermes/kanban.db',
      canonicalPath: '/home/openclaw/.hermes/kanban.db',
      isCanonical: true,
    })
    expect(mod.getKanbanBackendMeta().details).toContain('Canonical root Hermes Kanban board detected')
    expect(mod.listKanbanCards()[0]).toMatchObject({ id: 't_direct', status: 'ready' })
  })

  it('resolves canonical Kanban paths from legacy profile-home env fallback too', async () => {
    vi.stubEnv('CLAUDE_HOME', '/home/openclaw/.hermes/profiles/swarm5/home')
    const mod = await loadKanbanBackend({
      existsSync: (target) => target === '/home/openclaw/.hermes/kanban.db',
      execFileSync: (command, args = []) => {
        if (command === 'which' && args[0] === 'claude') throw new Error('not found')
        if (command === 'sqlite3') return '[]'
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
      },
    })

    expect(mod.getKanbanBackendMeta()).toMatchObject({
      id: 'claude',
      detected: true,
      path: '/home/openclaw/.hermes/kanban.db',
      canonicalPath: '/home/openclaw/.hermes/kanban.db',
      isCanonical: true,
    })
  })

  it('auto-detect falls back to local when canonical Hermes storage is missing', async () => {
    vi.stubEnv('CLAUDE_HOME', '/home/openclaw/.hermes/profiles/swarm2')
    const mod = await loadKanbanBackend({
      existsSync: () => false,
      execFileSync: (command, args = []) => {
        if (command === 'which' && args[0] === 'claude') return '/Users/aurora/.local/bin/claude\n'
        if (command === '/Users/aurora/.local/bin/claude' && args[0] === '--version') return 'claude 1.0.0\n'
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
      },
    })

    expect(mod.getKanbanBackendMeta()).toMatchObject({
      id: 'local',
      detected: true,
      writable: true,
      path: '/tmp/swarm2-kanban.json',
      isCanonical: false,
      canonicalPath: null,
    })
    expect(mod.listKanbanCards()[0]?.id).toBe('local-1')
  })

  it('creates canonical tasks as todo/backlog and clears run pointers when leaving running', async () => {
    vi.stubEnv('CLAUDE_HOME', '/home/openclaw/.hermes/profiles/swarm2')
    const sqliteCalls: string[] = []
    let taskReadCount = 0
    const mod = await loadKanbanBackend({
      existsSync: (target) => target === '/home/openclaw/.hermes/kanban.db' || target === '/home/openclaw/.hermes/kanban',
      execFileSync: (command, args = []) => {
        if (command === 'which' && args[0] === 'claude') return '/Users/aurora/.local/bin/claude\n'
        if (command === '/Users/aurora/.local/bin/claude' && args[0] === '--version') return 'claude 1.0.0\n'
        if (command === 'sqlite3') {
          const sql = args[2] ?? ''
          sqliteCalls.push(sql)
          if (sql.includes('select id, status, current_run_id from tasks')) {
            return JSON.stringify([{ id: 't_deadbeef', status: 'running', current_run_id: 42 }])
          }
          if (sql.includes('select id, title, body, status, assignee, created_at')) {
            taskReadCount += 1
            return JSON.stringify([
              {
                id: 't_deadbeef',
                title: taskReadCount === 1 ? 'Created Hermes task' : 'Updated Hermes task',
                body: 'Task body',
                status: taskReadCount === 1 ? 'todo' : 'done',
                assignee: 'swarm6',
                created_at: 1777527540,
                updated_at: 1777527644,
              },
            ])
          }
          return '[]'
        }
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
      },
    })

    const created = mod.createKanbanCard({ title: 'Created Hermes task', spec: 'Task body', assignedWorker: 'swarm6', status: 'backlog' })
    const updated = mod.updateKanbanCard('t_deadbeef', { title: 'Updated Hermes task', status: 'done', assignedWorker: 'swarm6' })

    expect(created).toMatchObject({ id: 't_deadbeef', title: 'Created Hermes task', status: 'backlog', assignedWorker: 'swarm6', createdBy: 'claude-kanban' })
    expect(updated).toMatchObject({ id: 't_deadbeef', title: 'Updated Hermes task', status: 'done', assignedWorker: 'swarm6' })
    expect(sqliteCalls.some((call) => call.includes("insert into tasks"))).toBe(true)
    expect(sqliteCalls.some((call) => call.includes("'todo'"))).toBe(true)
    expect(sqliteCalls.some((call) => call.includes('update task_runs set'))).toBe(true)
    expect(sqliteCalls.some((call) => call.includes('current_run_id = NULL'))).toBe(true)
  })

  it('rejects manual canonical Running transitions from the workspace', async () => {
    vi.stubEnv('CLAUDE_HOME', '/home/openclaw/.hermes/profiles/swarm2')
    const mod = await loadKanbanBackend({
      existsSync: (target) => target === '/home/openclaw/.hermes/kanban.db' || target === '/home/openclaw/.hermes/kanban',
      execFileSync: (command, args = []) => {
        if (command === 'which' && args[0] === 'claude') return '/Users/aurora/.local/bin/claude\n'
        if (command === '/Users/aurora/.local/bin/claude' && args[0] === '--version') return 'claude 1.0.0\n'
        if (command === 'sqlite3') {
          const sql = args[2] ?? ''
          if (sql.includes('select id, status, current_run_id from tasks')) {
            return JSON.stringify([{ id: 't_deadbeef', status: 'ready', current_run_id: null }])
          }
          if (sql.includes('where id =')) {
            return JSON.stringify([{ id: 't_deadbeef', title: 'Ready task', body: '', status: 'ready', assignee: null, created_at: 1, updated_at: 1 }])
          }
          return '[]'
        }
        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`)
      },
    })

    expect(() => mod.createKanbanCard({ title: 'No direct running', status: 'running' })).toThrow(/cannot create canonical Hermes tasks directly in Running/i)
    expect(() => mod.updateKanbanCard('t_deadbeef', { status: 'running' })).toThrow(/cannot mark canonical Hermes tasks as running directly/i)
  })
})
