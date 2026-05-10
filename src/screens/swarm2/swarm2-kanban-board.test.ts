import { describe, expect, it } from 'vitest'
import { getAcceptanceMissingFields, getBoardBadgeTone, getKanbanBackendPresentation, getKanbanControlState } from './swarm2-kanban-board'

describe('Swarm2 Kanban backend presentation', () => {
  it('keeps the initial backend state quiet and non-committal while auto-detecting', () => {
    expect(getKanbanBackendPresentation(null)).toMatchObject({
      badgeLabel: 'Detecting board',
      badgeTone: 'unknown',
      toastTitle: 'Detecting Swarm Board backend',
    })
  })

  it('presents detected Kanban as the default shared board, not a backend demo', () => {
    expect(getKanbanBackendPresentation({
      id: 'claude',
      label: 'Hermes Kanban',
      detected: true,
      writable: true,
      details: 'Canonical storage detected',
      path: '/tmp/kanban.db',
    })).toMatchObject({
      badgeLabel: 'Shared board',
      badgeTone: 'claude',
      toastTitle: 'Board connected',
      toastBody: 'Board data is coming from the canonical Hermes SQLite store.',
      title: 'Canonical storage detected',
    })
  })

  it('presents local storage as an automatic fallback, not a manual control', () => {
    expect(getKanbanBackendPresentation({
      id: 'local',
      label: 'Local board',
      detected: true,
      writable: true,
      details: 'Using local Swarm board JSON store.',
      path: '/tmp/swarm2-kanban.json',
    })).toMatchObject({
      badgeLabel: 'Local fallback',
      badgeTone: 'local',
      toastTitle: 'Using local Swarm Board',
      toastBody: 'Using local Swarm board JSON store.',
    })
  })

  it('assigns board badge tones deterministically by slug', () => {
    expect(getBoardBadgeTone('mission-control')).toBe(getBoardBadgeTone('mission-control'))
    expect(getBoardBadgeTone('default')).toMatch(/^border-/)
    expect(getBoardBadgeTone(null)).toBe(getBoardBadgeTone('all'))
  })
})

describe('Swarm2 Kanban control-state helpers', () => {
  it('shows queued state until canonical claim evidence exists', () => {
    expect(getKanbanControlState({
      id: 't_demo',
      board: 'mission-control',
      title: 'Demo',
      status: 'ready',
      lane: 'ready',
      assignee: 'dollycode',
      createdBy: 'matrix',
      body: 'Spec',
      result: null,
      workspaceKind: null,
      workspacePath: null,
      currentRunId: null,
      createdAt: null,
      startedAt: null,
      completedAt: null,
      comments: [],
      recentRuns: [],
      acceptance: null,
      controlReceipts: [{
        kind: 'matrix_dispatch_receipt',
        createdAt: 1,
        mutationId: 'mx_1',
        actor: 'matrix',
        reason: 'dispatch now',
        action: null,
        detail: null,
        taskId: 't_demo',
        missionId: 'mission_1',
        assignmentId: 'assign_1',
        workerId: 'dollycode',
        delivery: 'tmux',
        ok: true,
        checkpointStatus: 'not-requested',
        stateAfter: 'ready',
        error: null,
      }],
      doneAudit: null,
    }).label).toBe('Dispatch queued')
  })

  it('shows claimed-spawned acceptance pending once run evidence exists without acceptance', () => {
    expect(getKanbanControlState({
      id: 't_demo',
      board: 'mission-control',
      title: 'Demo',
      status: 'running',
      lane: 'running',
      assignee: 'dollycode',
      createdBy: 'matrix',
      body: 'Spec',
      result: null,
      workspaceKind: null,
      workspacePath: null,
      currentRunId: 12,
      createdAt: null,
      startedAt: 2,
      completedAt: null,
      comments: [],
      recentRuns: [],
      acceptance: { accepted_by: 'dollycode' },
      controlReceipts: [],
      doneAudit: null,
    })).toMatchObject({
      label: 'Claimed-spawned · acceptance pending',
      tone: expect.stringContaining('amber'),
    })
  })

  it('shows accepted underway once all acceptance fields exist', () => {
    expect(getKanbanControlState({
      id: 't_demo',
      board: 'mission-control',
      title: 'Demo',
      status: 'running',
      lane: 'running',
      assignee: 'dollycode',
      createdBy: 'matrix',
      body: 'Spec',
      result: null,
      workspaceKind: null,
      workspacePath: null,
      currentRunId: 12,
      createdAt: null,
      startedAt: 2,
      completedAt: null,
      comments: [],
      recentRuns: [],
      acceptance: {
        accepted_by: 'dollycode',
        accepted_at: '2026-05-10T00:00:00Z',
        lane: 'matrix',
        scope_understood: 'yes',
        first_action: 'wire controls',
        expected_artifact: 'ui',
        risk_level: 'medium',
        will_not_do: 'broad redesign',
      },
      controlReceipts: [],
      doneAudit: null,
    }).label).toBe('Accepted / underway')
  })

  it('tracks exactly which acceptance fields are missing', () => {
    expect(getAcceptanceMissingFields({ accepted_by: 'dollycode', lane: 'matrix' })).toEqual([
      'accepted_at',
      'scope_understood',
      'first_action',
      'expected_artifact',
      'risk_level',
      'will_not_do',
    ])
  })
})
