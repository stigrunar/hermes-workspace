// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}))

import { useQuery } from '@tanstack/react-query'
import { Swarm2KanbanBoard } from './swarm2-kanban-board'

async function renderInto(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await React.act(async () => {
    root.render(element)
  })
  return {
    container,
    unmount: async () => {
      await React.act(async () => {
        root.unmount()
      })
      document.body.removeChild(container)
    },
  }
}

async function waitFor(check: () => void, timeoutMs = 3000) {
  const started = Date.now()
  while (true) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(text)) as HTMLButtonElement | null
}

beforeEach(() => {
  vi.mocked(useQuery).mockImplementation((options: any) => {
    const key = Array.isArray(options?.queryKey) ? options.queryKey : []
    const isDetail = key.includes('detail')
    if (!isDetail) {
      return {
        data: {
          cards: [
            {
              id: 't_demo',
              title: 'Task A',
              spec: 'Spec body',
              acceptanceCriteria: [],
              assignedWorker: 'dollycode',
              reviewer: null,
              status: 'ready',
              missionId: null,
              reportPath: null,
              createdBy: 'matrix',
              createdAt: 1,
              updatedAt: 2,
              boardSlug: 'mission-control',
              boardLabel: 'Mission Control',
              boardSource: 'sqlite',
              doneAudit: null,
              shipping: {
                shippingState: 'active_build',
                activeSlotType: 'build',
                ownerLane: 'dollycode',
                acceptanceCriteria: 'Spec signed off',
                doneDefinition: 'Green tests',
                dummyOrNoSecretsPlan: 'Use fixture data',
                codexAcpSpecReady: 'true',
                displacesOrParks: 'park legacy build',
                lastShippingReviewAt: '2026-05-14',
              },
            },
            {
              id: 't_done',
              title: 'Finished Slice',
              spec: 'Historical completed work',
              acceptanceCriteria: [],
              assignedWorker: 'dollycode',
              reviewer: null,
              status: 'done',
              missionId: null,
              reportPath: null,
              latestSummary: 'Done handoff',
              createdBy: 'matrix',
              createdAt: 1,
              updatedAt: 3,
              boardSlug: 'mission-control',
              boardLabel: 'Mission Control',
              boardSource: 'sqlite',
              doneAudit: null,
              shipping: null,
            },
          ],
          shippingGovernor: {
            activeBuildCount: 3,
            activeBuildLimit: 2,
            activeResearchPlanCount: 1,
            activeResearchPlanLimit: 3,
            candidateCount: 0,
            ideaCount: 0,
            parkedCount: 0,
            killedCount: 0,
            shippedCount: 0,
            overActiveBuildLimit: true,
            overResearchPlanLimit: false,
            warnings: ['Active Build limit exceeded (3/2). Park/finish another build or record Stig override before routing more build work.'],
          },
          backend: { id: 'claude', label: 'Hermes Kanban', detected: true, writable: true, details: 'Canonical', path: '/tmp/kanban.db' },
          boards: [{ slug: 'mission-control', label: 'Mission Control', available: true, current: true, source: 'sqlite' }],
          selectedBoard: { requested: 'mission-control', slug: 'mission-control', label: 'Mission Control', fallback: false },
          readOnly: false,
          taskDetail: null,
        },
        isPending: false,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      }
    }
    if (!options?.enabled) {
      return {
        data: null,
        isPending: false,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      }
    }
    return {
      data: {
        id: 't_demo',
        board: 'mission-control',
        title: 'Task A',
        status: 'running',
        lane: 'running',
        assignee: 'dollycode',
        createdBy: 'matrix',
        body: 'Spec body',
        result: null,
        workspaceKind: 'dir',
        workspacePath: '/tmp/matrix',
        currentRunId: 77,
        createdAt: 1,
        startedAt: 2,
        completedAt: null,
        comments: [],
        recentRuns: [],
        acceptance: { accepted_by: 'dollycode' },
        controlReceipts: [{
          kind: 'matrix_dispatch_receipt',
          createdAt: 2,
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
          stateAfter: 'running',
          error: null,
        }],
        doneAudit: null,
      },
      isPending: false,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Swarm2KanbanBoard bounded Matrix controls', () => {
  it('renders only bounded controls and surfaces canonical acceptance-pending state with receipts', async () => {
    const { container, unmount } = await renderInto(
      <Swarm2KanbanBoard workers={[{ id: 'dollycode', displayName: 'DollyCode' }, { id: 'dollyqa', displayName: 'DollyQA' }]} />,
    )

    await waitFor(() => {
      expect(container.textContent).toContain('Create task')
      expect(container.textContent).toContain('Safe actions only')
    })

    expect(container.textContent).toContain('Create draft')
    expect(container.textContent).toContain('Create ready')
    expect(container.textContent).not.toContain('Mark running')
    expect(container.textContent).not.toContain('Mark done')

    const cardButton = buttonByText(container, 'Task A')
    expect(cardButton).toBeTruthy()
    await React.act(async () => {
      cardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await waitFor(() => {
      expect(container.textContent).toContain('Claimed-spawned · acceptance pending')
      expect(container.textContent).toContain('Control receipts')
      expect(container.textContent).toContain('assign_1')
    })

    expect(container.textContent).toContain('Missing acceptance fields:')
    expect(container.textContent).toContain('Request dispatch')
    expect(container.textContent).toContain('Reassign worker')
    expect(container.textContent).toContain('Add routing comment')

    await unmount()
  })

  it('collapses done cards by default and expands them on demand', async () => {
    const { container, unmount } = await renderInto(
      <Swarm2KanbanBoard workers={[{ id: 'dollycode', displayName: 'DollyCode' }]} />,
    )

    await waitFor(() => {
      expect(container.textContent).toContain('Done cards collapsed')
      expect(container.textContent).toContain('1 completed card hidden')
    })

    expect(container.textContent).not.toContain('Finished Slice')

    const showDoneButton = buttonByText(container, 'Show done')
    expect(showDoneButton).toBeTruthy()
    await React.act(async () => {
      showDoneButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await waitFor(() => {
      expect(container.textContent).toContain('Finished Slice')
      expect(buttonByText(container, 'Collapse done')).toBeTruthy()
    })

    await unmount()
  })
})
