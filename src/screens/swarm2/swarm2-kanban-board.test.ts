import { describe, expect, it } from 'vitest'
import { deriveKanbanAssigneeOptions, getKanbanBackendPresentation } from './swarm2-kanban-board'

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
      toastBody: 'Cards and status changes are using the canonical Kanban store.',
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
})

describe('deriveKanbanAssigneeOptions', () => {
  it('prefers active Hermes assignees while still preserving observed board-only ids', () => {
    expect(deriveKanbanAssigneeOptions({
      workers: [
        { id: 'dollycode', displayName: 'DollyCode' },
        { id: 'dollyops', displayName: 'DollyOps' },
      ],
      assignees: [
        { id: 'dollycode', label: 'DollyCode', isHuman: false },
        { id: 'dollydesign', label: 'DollyDesign', isHuman: false },
        { id: 'dollyprivate', label: 'DollyPrivate', isHuman: false },
      ],
      cards: [
        {
          id: 't1',
          title: 'Legacy handoff',
          spec: '',
          acceptanceCriteria: [],
          assignedWorker: 'legacy-worker',
          reviewer: 'dollyprivate',
          status: 'ready',
          missionId: null,
          reportPath: null,
          createdBy: 'test',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })).toEqual([
      { id: 'dollycode', label: 'DollyCode', isHuman: false },
      { id: 'dollydesign', label: 'DollyDesign', isHuman: false },
      { id: 'dollyops', label: 'DollyOps', isHuman: false },
      { id: 'dollyprivate', label: 'DollyPrivate', isHuman: false },
      { id: 'legacy-worker', label: 'legacy-worker', isHuman: false },
    ])
  })

  it('keeps human reviewers available but sorted after worker profiles', () => {
    expect(deriveKanbanAssigneeOptions({
      workers: [{ id: 'dollycode', displayName: 'DollyCode' }],
      assignees: [
        { id: 'alex-reviewer', label: 'Alex Reviewer', isHuman: true },
        { id: 'dollydesign', label: 'DollyDesign', isHuman: false },
      ],
      cards: [],
    })).toEqual([
      { id: 'dollycode', label: 'DollyCode', isHuman: false },
      { id: 'dollydesign', label: 'DollyDesign', isHuman: false },
      { id: 'alex-reviewer', label: 'Alex Reviewer', isHuman: true },
    ])
  })
})
