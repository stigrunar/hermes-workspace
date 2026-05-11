import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let hermesHome = ''

function writeProfile(id: string, model = 'gpt-5.4') {
  const profileDir = join(hermesHome, 'profiles', id)
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'config.yaml'), `model: ${model}\n`)
}

async function loadModule() {
  vi.resetModules()
  return import('./kanban-assignees')
}

beforeEach(() => {
  hermesHome = mkdtempSync(join(tmpdir(), 'kanban-assignees-'))
  process.env.HERMES_HOME = hermesHome
  mkdirSync(join(hermesHome, 'profiles'), { recursive: true })
  writeFileSync(join(hermesHome, 'config.yaml'), 'tasks:\n  human_reviewer: reviewer\n')
  writeProfile('swarm3')
  writeProfile('dollyresearch')
  writeProfile('dollyqa')
})

afterEach(() => {
  delete process.env.HERMES_HOME
  rmSync(hermesHome, { recursive: true, force: true })
  vi.resetModules()
})

describe('kanban assignee labels and scope guards', () => {
  it('formats functional labels with stable ids for roster-backed and named profiles', async () => {
    const { listKnownKanbanAssignees } = await loadModule()
    const assignees = listKnownKanbanAssignees({
      remotePayload: {
        assignees: [
          { id: 'swarm3', label: 'swarm3' },
          { id: 'dollyresearch', label: 'dollyresearch' },
          { id: 'dollyqa', label: 'dollyqa' },
        ],
      },
      humanReviewer: 'reviewer',
    })

    const labels = new Map(assignees.map((assignee) => [assignee.id, assignee.label]))
    expect(labels.get('swarm3')).toBe('Control Mirror · swarm3')
    expect(labels.get('dollyresearch')).toBe('DollyResearch · dollyresearch')
    expect(labels.get('dollyqa')).toBe('DollyQA · dollyqa')
  })

  it('rejects PM/spec/routing task scope for numeric swarm assignees', async () => {
    const { getAssigneeTaskScopeSupport } = await loadModule()
    expect(getAssigneeTaskScopeSupport('swarm3', {
      title: 'Synthesize kickoff research and route next phase',
      body: 'Update PROJECT_BRIEF.md and TASKS.md with the governance decision.',
    })).toEqual({
      allowed: false,
      reason: 'Assignee "swarm3" cannot own PM/spec/governance/next-phase routing work from The Matrix. Route this task to a named durable owner such as default, dollydesign, dollyops, dollyresearch, dollyqa, or dollycode instead.',
    })
  })

  it('allows named research and qa profiles for bounded research and smoke work', async () => {
    const { getAssigneeTaskScopeSupport } = await loadModule()
    expect(getAssigneeTaskScopeSupport('dollyresearch', {
      title: 'Research source pack for Expo auth options',
      body: 'Collect docs and compare tradeoffs.',
    })).toEqual({ allowed: true, reason: null })
    expect(getAssigneeTaskScopeSupport('dollyqa', {
      title: 'QA smoke on deploy candidate',
      body: 'Run smoke verification and report failures.',
    })).toEqual({ allowed: true, reason: null })
  })
})
