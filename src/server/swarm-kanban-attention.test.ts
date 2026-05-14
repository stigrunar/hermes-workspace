import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

let tmpRoot: string | null = null

afterEach(() => {
  vi.resetModules()
  vi.unstubAllEnvs()
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true })
  tmpRoot = null
})

function createKanbanDb(dbPath: string, sql: string) {
  execFileSync('sqlite3', [dbPath, `
    create table tasks (
      id text primary key,
      title text,
      body text,
      status text,
      assignee text,
      tenant text,
      priority integer,
      created_at integer,
      started_at integer,
      completed_at integer,
      result text
    );
    create table task_events (
      id integer primary key autoincrement,
      task_id text,
      kind text,
      payload text,
      created_at integer
    );
    create table task_comments (
      id integer primary key autoincrement,
      task_id text,
      author text,
      body text,
      created_at integer
    );
    create table task_links (parent_id text, child_id text);
    ${sql}
  `])
}

describe('swarm-kanban-attention', () => {
  it('classifies zero-ready open non-human blockers as an autonomy deadlock', async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'matrix-attention-'))
    vi.stubEnv('HERMES_HOME', tmpRoot)
    const dbPath = join(tmpRoot, 'kanban.db')
    createKanbanDb(dbPath, `
      insert into tasks (id, title, status, assignee, tenant, priority, created_at, result)
      values ('t_blocked', 'Runtime dispatch failed', 'blocked', 'dollyops', 'default', 10, 100, 'worker protocol timed out');
      insert into task_events (task_id, kind, payload, created_at)
      values ('t_blocked', 'blocked', '{"reason":"Worker protocol timed out after spawn"}', 101);
    `)

    const mod = await import('./swarm-kanban-attention')
    const snapshot = mod.getMatrixAttentionSnapshot()

    expect(snapshot).toMatchObject({
      available: true,
      controlPlane: 'the-matrix',
      storage: 'hermes-kanban',
      zeroReady: true,
      zeroReadyOpenWork: true,
      autonomyDeadlock: true,
      nonHumanBlockedCount: 1,
    })
    expect(snapshot.autonomyDeadlockBoards).toEqual(['Root board'])
    expect(snapshot.classifiedOpenTaskPreview[0]).toMatchObject({
      id: 't_blocked',
      blockerClass: 'runtime_worker_crash',
      blockerClassLabel: 'runtime/worker crash',
    })
    expect(snapshot.attentionItems.map((item) => item.text).join('\n')).toContain('Autonomy deadlock')
  })

  it('surfaces done slices with open follow-up as attention even when the parent is done', async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'matrix-attention-'))
    vi.stubEnv('HERMES_HOME', tmpRoot)
    mkdirSync(join(tmpRoot, 'kanban', 'boards', 'ops-board'), { recursive: true })
    const dbPath = join(tmpRoot, 'kanban', 'boards', 'ops-board', 'kanban.db')
    createKanbanDb(dbPath, `
      insert into tasks (id, title, status, assignee, tenant, priority, created_at, completed_at)
      values ('t_parent', 'Slice landed', 'done', 'dollycode', 'mission', 5, 100, 200);
      insert into tasks (id, title, status, assignee, tenant, priority, created_at)
      values ('t_child', 'Deploy follow-up', 'blocked', 'dollyops', 'mission', 9, 201);
      insert into task_links (parent_id, child_id) values ('t_parent', 't_child');
    `)

    const mod = await import('./swarm-kanban-attention')
    const snapshot = mod.getMatrixAttentionSnapshot()

    expect(snapshot.boardCount).toBe(1)
    expect(snapshot.doneWithOpenChildCount).toBe(1)
    expect(snapshot.doneWithOpenChildPreview[0]).toMatchObject({
      parentId: 't_parent',
      childId: 't_child',
      childStatus: 'blocked',
      board: 'Ops Board',
    })
    expect(snapshot.autonomyDeadlock).toBe(true)
    expect(snapshot.attentionItems.map((item) => item.text).join('\n')).toContain('done slices still have open follow-up')
    expect(snapshot.suggestedActions.map((action) => action.action)).toContain('review_follow_up')
  })

  it('returns Shipping Governor summary and advisory actions when portfolio limits are exceeded', async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'matrix-attention-'))
    vi.stubEnv('HERMES_HOME', tmpRoot)
    const dbPath = join(tmpRoot, 'kanban.db')
    createKanbanDb(dbPath, `
      insert into tasks (id, title, body, status, assignee, tenant, priority, created_at)
      values
        ('t_build_1', 'Build one', 'shipping_state: active_build\nactive_slot_type: build', 'ready', 'dollycode', 'matrix', 10, 100),
        ('t_build_2', 'Build two', 'shipping_state: active_build\nactive_slot_type: build', 'ready', 'dollycode', 'matrix', 9, 101),
        ('t_build_3', 'Build three', 'shipping_state: active_build\nactive_slot_type: build', 'blocked', 'dollycode', 'matrix', 8, 102),
        ('t_research_1', 'Research one', 'shipping_state: candidate\nactive_slot_type: research_plan', 'ready', 'dollyresearch', 'matrix', 7, 103),
        ('t_research_2', 'Research two', 'shipping_state: candidate\nactive_slot_type: research_plan', 'ready', 'dollyresearch', 'matrix', 6, 104),
        ('t_research_3', 'Research three', 'shipping_state: candidate\nactive_slot_type: research_plan', 'ready', 'dollyresearch', 'matrix', 5, 105),
        ('t_research_4', 'Research four', 'shipping_state: candidate\nactive_slot_type: research_plan', 'ready', 'dollyresearch', 'matrix', 4, 106);
    `)

    const mod = await import('./swarm-kanban-attention')
    const snapshot = mod.getMatrixAttentionSnapshot()

    expect(snapshot.shippingGovernor).toMatchObject({
      activeBuildCount: 3,
      activeBuildLimit: 2,
      activeResearchPlanCount: 4,
      activeResearchPlanLimit: 3,
      candidateCount: 4,
      overActiveBuildLimit: true,
      overResearchPlanLimit: true,
    })
    expect(snapshot.attentionItems.map((item) => item.text).join('\n')).toContain('Shipping Governor: Active Build limit exceeded (3/2)')
    expect(snapshot.attentionItems.map((item) => item.text).join('\n')).toContain('Shipping Governor: Research/Planning limit exceeded (4/3)')
    expect(snapshot.suggestedActions.map((action) => action.action)).toEqual(expect.arrayContaining([
      'review_shipping_slots',
      'park_or_finish_before_new_build',
      'review_research_plan_pressure',
    ]))
  })
})
