'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { MATRIX_BOARD_LABEL, MATRIX_DEFAULT_BOARD_SLUG } from '@/lib/matrix-branding'
import { fetchAssignees, type TaskAssignee } from '@/lib/tasks-api'

type KanbanLane = 'backlog' | 'ready' | 'running' | 'review' | 'blocked' | 'done'

type SwarmKanbanCard = {
  id: string
  title: string
  spec: string
  acceptanceCriteria: Array<string>
  assignedWorker: string | null
  reviewer: string | null
  status: KanbanLane
  missionId: string | null
  reportPath: string | null
  latestSummary?: string | null
  createdBy: string
  createdAt: number
  updatedAt: number
  boardSlug?: string
  boardLabel?: string
  boardSource?: KanbanBoardOption['source']
  doneAudit?: KanbanDoneAudit | null
}

type KanbanWorker = {
  id: string
  displayName?: string | null
  role?: string | null
}

type DispatchableAssignee = TaskAssignee & {
  dispatchSupported: true
}

type MatrixControlPlaneContract = {
  owner: 'the-matrix'
  role: 'control-plane'
  nativeKanbanRole: 'execution-storage'
  mutationEndpoint: '/api/swarm-kanban-control'
  dispatchEndpoint: '/api/swarm-dispatch'
  completionOwner: 'worker-kanban-complete'
  storage: 'hermes-kanban' | 'local-fallback'
  execution: 'hermes-kanban-dispatcher' | 'local-only'
  legacyMutationEndpointWritable: boolean
  warnings: Array<string>
}

type KanbanBackendMeta = {
  id: 'local' | 'claude' | 'hermes-proxy'
  label: string
  detected: boolean
  writable: boolean
  details?: string | null
  path?: string | null
  controlPlane?: MatrixControlPlaneContract
}

type KanbanBoardOption = {
  slug: string
  label: string
  description?: string | null
  available: boolean
  current: boolean
  source: 'aggregate' | 'dashboard' | 'sqlite' | 'local'
}

type KanbanSelectedBoard = {
  requested: string | null
  slug: string
  label: string
  description?: string | null
  fallback: boolean
}

type KanbanTaskComment = {
  author: string | null
  body: string
  createdAt: number | null
}

type KanbanTaskRun = {
  id: number
  status: string | null
  outcome: string | null
  summary: string | null
  metadata: string | null
  error: string | null
  startedAt: number | null
  endedAt: number | null
}

type KanbanTaskAcceptance = Partial<Record<
  'accepted_by' | 'accepted_at' | 'lane' | 'scope_understood' | 'first_action' | 'expected_artifact' | 'risk_level' | 'will_not_do',
  string
>>

type KanbanControlReceipt = {
  kind: 'matrix_control' | 'matrix_dispatch_receipt'
  createdAt: number | null
  mutationId: string | null
  actor: string | null
  reason: string | null
  action: string | null
  detail: string | null
  taskId: string | null
  missionId: string | null
  assignmentId: string | null
  workerId: string | null
  delivery: string | null
  ok: boolean | null
  checkpointStatus: string | null
  stateAfter: string | null
  error: string | null
}

type KanbanOpenChild = {
  id: string
  title: string
  status: string
  assignee: string | null
}

type KanbanDoneAudit = {
  openChildCount: number
  openChildren: Array<KanbanOpenChild>
  completedEventCount: number
  completedRunCount: number
  warnings: Array<string>
}

type KanbanTaskDetail = {
  id: string
  board: string
  title: string
  status: string
  lane: KanbanLane
  assignee: string | null
  createdBy: string | null
  body: string
  result: string | null
  latestSummary: string | null
  workspaceKind: string | null
  workspacePath: string | null
  currentRunId: number | null
  createdAt: number | null
  startedAt: number | null
  completedAt: number | null
  comments: Array<KanbanTaskComment>
  recentRuns: Array<KanbanTaskRun>
  acceptance: KanbanTaskAcceptance | null
  controlReceipts: Array<KanbanControlReceipt>
  doneAudit: KanbanDoneAudit | null
}

type KanbanResponse = {
  cards?: Array<SwarmKanbanCard>
  backend?: KanbanBackendMeta
  boards?: Array<KanbanBoardOption>
  selectedBoard?: KanbanSelectedBoard
  readOnly?: boolean
  taskDetail?: KanbanTaskDetail | null
}

type Swarm2KanbanBoardProps = {
  workers: Array<KanbanWorker>
  latestMission?: { id: string; title: string; state: string } | null
  selectedWorkerId?: string | null
  onSelectWorker?: (workerId: string) => void
  onOpenRouter?: () => void
  className?: string
}

type KanbanBackendPresentation = {
  badgeLabel: string
  badgeTone: 'hermes-proxy' | 'claude' | 'local' | 'unknown'
  toastTitle: string
  toastBody: string
  title: string | undefined
  dashboardUrl?: string
}

type SelectedKanbanTask = {
  id: string
  boardSlug: string
  boardLabel: string
}

export function getKanbanBackendPresentation(backend: KanbanBackendMeta | null | undefined): KanbanBackendPresentation {
  if (!backend) {
    return {
      badgeLabel: 'Detecting board',
      badgeTone: 'unknown',
      toastTitle: 'Detecting Swarm Board backend',
      toastBody: 'Checking Hermes Kanban before falling back locally.',
      title: undefined,
    }
  }
  if (backend.id === 'hermes-proxy' && backend.detected) {
    const dashboardUrl =
      typeof backend.path === 'string' && backend.path.startsWith('http')
        ? `${backend.path.replace(/\/+$/, '')}/kanban`
        : undefined
    return {
      badgeLabel: 'Synced • Hermes',
      badgeTone: 'hermes-proxy',
      toastTitle: 'Synced with Hermes Dashboard',
      toastBody: 'The Matrix is the control plane. Hermes Kanban is the execution/storage layer, and mutations go through bounded Matrix controls.',
      title: backend.details ?? backend.path ?? 'Hermes Dashboard kanban plugin detected',
      dashboardUrl,
    }
  }
  if (backend.id === 'claude' && backend.detected) {
    return {
      badgeLabel: 'Shared board',
      badgeTone: 'claude',
      toastTitle: 'Board connected',
      toastBody: 'The Matrix is the control plane. The canonical Hermes SQLite store remains the execution/storage layer.',
      title: backend.details ?? backend.path ?? 'Canonical Kanban store detected',
    }
  }
  return {
    badgeLabel: 'Local fallback',
    badgeTone: 'local',
    toastTitle: 'Using local Swarm Board',
    toastBody: backend.details || 'Hermes Kanban is not available yet. The Matrix will stay read-only and fall back automatically.',
    title: backend.details ?? backend.path ?? 'Local Swarm Board fallback',
  }
}

const LANES: Array<{ id: KanbanLane; label: string; hint: string }> = [
  { id: 'backlog', label: 'Backlog', hint: 'Captured, not committed' },
  { id: 'ready', label: 'Ready', hint: 'Spec clear, safe to dispatch' },
  { id: 'running', label: 'Running', hint: 'Worker executing' },
  { id: 'review', label: 'Review', hint: 'Needs peer/human check' },
  { id: 'blocked', label: 'Blocked', hint: 'Needs input or dependency' },
  { id: 'done', label: 'Done', hint: 'Scoped slice accepted' },
]

const LANE_TONE: Record<KanbanLane, string> = {
  backlog: 'border-slate-400/40 bg-slate-500/10 text-slate-700',
  ready: 'border-blue-400/40 bg-blue-500/10 text-blue-700',
  running: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700',
  review: 'border-violet-400/40 bg-violet-500/10 text-violet-700',
  blocked: 'border-red-400/40 bg-red-500/10 text-red-700',
  done: 'border-green-400/40 bg-green-500/10 text-green-700',
}

const ALL_BOARDS_SLUG = 'all'

const BOARD_BADGE_TONES = [
  'border-cyan-400/40 bg-cyan-500/10 text-cyan-700',
  'border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-700',
  'border-lime-400/40 bg-lime-500/10 text-lime-700',
  'border-orange-400/40 bg-orange-500/10 text-orange-700',
  'border-sky-400/40 bg-sky-500/10 text-sky-700',
  'border-rose-400/40 bg-rose-500/10 text-rose-700',
] as const

export function getBoardBadgeTone(slug: string | null | undefined): string {
  const value = slug?.trim() || ALL_BOARDS_SLUG
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return BOARD_BADGE_TONES[hash % BOARD_BADGE_TONES.length]
}

function doneAuditLacksEvidence(audit: KanbanDoneAudit | null | undefined): boolean {
  return Boolean(audit?.warnings.length) && audit?.completedEventCount === 0 && audit.completedRunCount === 0
}

const ACCEPTANCE_FIELDS = [
  'accepted_by',
  'accepted_at',
  'lane',
  'scope_understood',
  'first_action',
  'expected_artifact',
  'risk_level',
  'will_not_do',
] as const

export function getAcceptanceMissingFields(acceptance: KanbanTaskAcceptance | null | undefined): Array<string> {
  return ACCEPTANCE_FIELDS.filter((field) => !acceptance?.[field]?.trim())
}

function latestDispatchReceipt(receipts: Array<KanbanControlReceipt> | null | undefined): KanbanControlReceipt | null {
  return receipts?.find((receipt) => receipt.kind === 'matrix_dispatch_receipt') ?? null
}

function latestMatrixControlReceipt(receipts: Array<KanbanControlReceipt> | null | undefined): KanbanControlReceipt | null {
  return receipts?.find((receipt) => receipt.kind === 'matrix_control') ?? null
}

export function taskHasClaimEvidence(detail: KanbanTaskDetail | null | undefined): boolean {
  if (!detail) return false
  return Boolean(detail.currentRunId || detail.startedAt || detail.lane === 'running' || detail.status.toLowerCase() === 'claimed')
}

function taskHasUsableScope(detail: KanbanTaskDetail | null | undefined): boolean {
  if (!detail) return false
  return `${detail.title}\n${detail.body}`.trim().length > 0
}

type KanbanControlState = {
  label: string
  tone: string
  note: string | null
}

export function getKanbanControlState(detail: KanbanTaskDetail | null): KanbanControlState {
  if (!detail) {
    return {
      label: 'Loading canonical state',
      tone: 'border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-muted)]',
      note: null,
    }
  }
  const dispatch = latestDispatchReceipt(detail.controlReceipts)
  const acceptanceMissing = getAcceptanceMissingFields(detail.acceptance)
  if (detail.lane === 'done') {
    return {
      label: 'Done via worker',
      tone: 'border-green-400/40 bg-green-500/10 text-green-700',
      note: 'Completion remains worker-owned. Matrix only reads the canonical evidence here.',
    }
  }
  if (dispatch?.ok === false) {
    return {
      label: 'Dispatch failed',
      tone: 'border-red-400/40 bg-red-500/10 text-red-700',
      note: dispatch.error ?? 'Canonical dispatch receipt recorded a failed delivery attempt.',
    }
  }
  if (taskHasClaimEvidence(detail)) {
    if (acceptanceMissing.length === 0) {
      return {
        label: 'Accepted / underway',
        tone: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700',
        note: 'Claim evidence exists and the specialist acceptance fields are complete.',
      }
    }
    return {
      label: 'Claimed-spawned · acceptance pending',
      tone: 'border-amber-400/40 bg-amber-500/10 text-amber-700',
      note: `Claim evidence exists, but acceptance is still missing: ${acceptanceMissing.join(', ')}`,
    }
  }
  if (dispatch) {
    return {
      label: 'Dispatch queued',
      tone: 'border-blue-400/40 bg-blue-500/10 text-blue-700',
      note: dispatch.assignmentId
        ? `Receipt ${dispatch.assignmentId} is recorded. Keep showing queued until canonical claim evidence appears.`
        : 'Dispatch receipt is recorded. Keep showing queued until canonical claim evidence appears.',
    }
  }
  if (detail.lane === 'blocked') {
    return {
      label: 'Blocked',
      tone: 'border-red-400/40 bg-red-500/10 text-red-700',
      note: latestMatrixControlReceipt(detail.controlReceipts)?.reason ?? 'This task is blocked in canonical storage.',
    }
  }
  if (detail.lane === 'ready') {
    return {
      label: 'Ready',
      tone: 'border-blue-400/40 bg-blue-500/10 text-blue-700',
      note: 'Ready is the highest Matrix-owned lane. Dispatch can be requested from here.',
    }
  }
  return {
    label: detail.status || 'Unknown',
    tone: 'border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-muted)]',
    note: null,
  }
}

type KanbanBoardQuery = {
  cards: Array<SwarmKanbanCard>
  backend: KanbanBackendMeta | null
  boards: Array<KanbanBoardOption>
  selectedBoard: KanbanSelectedBoard
  readOnly: boolean
  taskDetail: KanbanTaskDetail | null
}

async function fetchKanbanBoard(board: string, taskId?: string | null): Promise<KanbanBoardQuery> {
  const params = new URLSearchParams()
  if (board) params.set('board', board)
  if (taskId) params.set('taskId', taskId)
  const suffix = params.toString()
  const res = await fetch(`/api/swarm-kanban${suffix ? `?${suffix}` : ''}`)
  if (!res.ok) throw new Error(`Kanban request failed: ${res.status}`)
  const data = (await res.json()) as KanbanResponse
  return {
    cards: Array.isArray(data.cards) ? data.cards : [],
    backend: data.backend ?? null,
    boards: Array.isArray(data.boards) ? data.boards : [],
    selectedBoard: data.selectedBoard ?? { requested: board, slug: board, label: board, description: null, fallback: false },
    readOnly: data.readOnly ?? true,
    taskDetail: data.taskDetail ?? null,
  }
}

function workerLabel(workers: Array<KanbanWorker>, workerId: string | null): string {
  if (!workerId) return 'Unassigned'
  const worker = workers.find((item) => item.id === workerId)
  return worker?.displayName || workerId
}

function formatTimestamp(value: number | null | undefined): string {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return '—'
  }
}

function formatMetadata(value: string | null): string | null {
  if (!value?.trim()) return null
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

export function Swarm2KanbanBoard({
  workers,
  onSelectWorker,
  onOpenRouter,
  className,
}: Swarm2KanbanBoardProps) {
  const [requestedBoard, setRequestedBoard] = useState(ALL_BOARDS_SLUG)
  const [selectedTask, setSelectedTask] = useState<SelectedKanbanTask | null>(null)
  const [backendToast, setBackendToast] = useState<KanbanBackendPresentation | null>(null)
  const [createTitle, setCreateTitle] = useState('')
  const [createBody, setCreateBody] = useState('')
  const [createAssignee, setCreateAssignee] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editBody, setEditBody] = useState('')
  const [assignWorkerId, setAssignWorkerId] = useState('')
  const [routingComment, setRoutingComment] = useState('')
  const [actionReason, setActionReason] = useState('')
  const [dispatchReason, setDispatchReason] = useState('')
  const [reassignWorkerId, setReassignWorkerId] = useState('')
  const [reassignReason, setReassignReason] = useState('')
  const [reclaimReason, setReclaimReason] = useState('')
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const lastToastedBackendKey = useRef<string | null>(null)

  const query = useQuery({
    queryKey: ['swarm2', 'kanban', requestedBoard],
    queryFn: () => fetchKanbanBoard(requestedBoard),
    refetchInterval: 5_000,
    staleTime: 2_000,
  })

  const detailQuery = useQuery({
    enabled: Boolean(selectedTask),
    queryKey: ['swarm2', 'kanban', selectedTask?.boardSlug, 'detail', selectedTask?.id],
    queryFn: () => fetchKanbanBoard(selectedTask?.boardSlug ?? requestedBoard, selectedTask?.id).then((data) => data.taskDetail),
    staleTime: 2_000,
  })

  const assigneesQuery = useQuery({
    queryKey: ['swarm2', 'kanban', 'assignees'],
    queryFn: fetchAssignees,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const backend = query.data?.backend ?? null
  const backendPresentation = useMemo(() => getKanbanBackendPresentation(backend), [backend])
  const selectedBoard = query.data?.selectedBoard
  const boards = query.data?.boards ?? []
  const readOnly = query.data?.readOnly ?? true

  useEffect(() => {
    if (!backend) return
    const backendKey = `${backend.id}:${backend.detected ? 'detected' : 'fallback'}:${backend.path ?? ''}`
    if (lastToastedBackendKey.current === backendKey) return
    lastToastedBackendKey.current = backendKey

    const storageKey = 'swarm2-kanban-backend-toast'
    if (typeof window !== 'undefined') {
      const lastSessionToast = window.sessionStorage.getItem(storageKey)
      if (lastSessionToast === backendKey) return
      window.sessionStorage.setItem(storageKey, backendKey)
    }

    const timeout = window.setTimeout(() => setBackendToast(null), 4_500)
    setBackendToast(getKanbanBackendPresentation(backend))
    return () => window.clearTimeout(timeout)
  }, [backend])

  const cardsByLane = useMemo(() => {
    const map = new Map<KanbanLane, Array<SwarmKanbanCard>>()
    for (const lane of LANES) map.set(lane.id, [])
    for (const card of query.data?.cards ?? []) {
      const bucket = map.get(card.status) ?? map.get('backlog')!
      bucket.push(card)
    }
    return map
  }, [query.data])

  const total = query.data?.cards.length ?? 0
  const reviewCount = cardsByLane.get('review')?.length ?? 0
  const blockedCount = cardsByLane.get('blocked')?.length ?? 0
  const doneWithFollowUpCount = (cardsByLane.get('done') ?? []).filter((card) => (card.doneAudit?.openChildCount ?? 0) > 0).length
  const doneMissingEvidenceCount = (cardsByLane.get('done') ?? []).filter((card) => doneAuditLacksEvidence(card.doneAudit)).length
  const supportedAssignees = useMemo(
    () => (assigneesQuery.data?.assignees ?? []).filter((assignee): assignee is DispatchableAssignee => assignee.dispatchSupported === true),
    [assigneesQuery.data?.assignees],
  )
  const unsupportedAssigneeMap = useMemo(
    () => new Map((assigneesQuery.data?.unsupportedAssignees ?? []).map((assignee) => [assignee.id, assignee] as const)),
    [assigneesQuery.data?.unsupportedAssignees],
  )
  const assigneeLabelMap = useMemo(
    () => new Map(
      [
        ...(assigneesQuery.data?.assignees ?? []),
        ...(assigneesQuery.data?.unsupportedAssignees ?? []),
      ].map((assignee) => [assignee.id, assignee.label] as const),
    ),
    [assigneesQuery.data?.assignees, assigneesQuery.data?.unsupportedAssignees],
  )
  const labelForWorker = (workerId: string | null) => {
    if (!workerId) return 'Unassigned'
    return assigneeLabelMap.get(workerId) ?? workerLabel(workers, workerId)
  }
  const detail = detailQuery.data ?? null
  const unsupportedCurrentAssignee = detail?.assignee ? unsupportedAssigneeMap.get(detail.assignee) ?? null : null
  const acceptanceMissingFields = getAcceptanceMissingFields(detail?.acceptance)
  const latestReceipt = latestDispatchReceipt(detail?.controlReceipts)
  const controlState = getKanbanControlState(detail)
  const mutableBoard = (selectedBoard?.slug ?? requestedBoard) === ALL_BOARDS_SLUG ? MATRIX_DEFAULT_BOARD_SLUG : (selectedBoard?.slug ?? requestedBoard)
  const claimEvidence = taskHasClaimEvidence(detail)
  const canEditTask = !readOnly && Boolean(detail) && detail?.lane !== 'done'
  const canAssignWorker = canEditTask && !claimEvidence
  const canMarkReady = canEditTask && !claimEvidence && detail?.lane !== 'ready'
  const canMarkBlocked = canEditTask && detail?.lane !== 'blocked'
  const canDispatch = !readOnly && Boolean(detail) && detail?.lane === 'ready' && !claimEvidence && Boolean(detail?.assignee?.trim()) && !unsupportedCurrentAssignee && taskHasUsableScope(detail)
  const canReclaim = !readOnly && Boolean(detail) && !claimEvidence

  useEffect(() => {
    if (!detail) return
    setEditTitle(detail.title)
    setEditBody(detail.body)
    setAssignWorkerId(detail.assignee ?? '')
    setReassignWorkerId(detail.assignee ?? '')
  }, [detail?.id, detail?.title, detail?.body, detail?.assignee])

  async function refreshBoard(taskOverride?: SelectedKanbanTask | null) {
    await query.refetch()
    if (taskOverride ?? selectedTask) {
      await detailQuery.refetch()
    }
  }

  async function runControlAction(payload: Record<string, unknown>, successMessage: string, taskOverride?: SelectedKanbanTask | null) {
    setPendingAction(String(payload.action ?? 'control'))
    setFeedback(null)
    try {
      const res = await fetch('/api/swarm-kanban-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; receipt?: { taskId?: string } }
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `Control request failed: ${res.status}`)
      }
      if (payload.action === 'create_task' && json.receipt?.taskId) {
        setCreateTitle('')
        setCreateBody('')
        setCreateAssignee('')
        setSelectedTask({ id: json.receipt.taskId, boardSlug: mutableBoard, boardLabel: selectedBoard?.label ?? MATRIX_BOARD_LABEL })
      }
      if (payload.action === 'add_comment') setRoutingComment('')
      if (payload.action === 'reassign_worker') setReassignReason('')
      if (payload.action === 'reclaim_worker') setReclaimReason('')
      if (payload.action === 'mark_ready' || payload.action === 'mark_blocked' || payload.action === 'assign_task' || payload.action === 'edit_task') {
        setActionReason('')
      }
      await refreshBoard(taskOverride)
      setFeedback({ tone: 'success', message: successMessage })
    } catch (error) {
      setFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Control request failed' })
    } finally {
      setPendingAction(null)
    }
  }

  async function runDispatchRequest() {
    if (!detail) return
    setPendingAction('request_dispatch')
    setFeedback(null)
    try {
      const res = await fetch('/api/swarm-dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: detail.id,
          board: detail.board,
          reason: dispatchReason.trim() || undefined,
          waitForCheckpoint: false,
          allowAsync: true,
        }),
      })
      const json = await res.json().catch(() => ({})) as { error?: string; receipt?: { missionId?: string | null } }
      if (!res.ok) {
        throw new Error(json.error || `Dispatch request failed: ${res.status}`)
      }
      await refreshBoard(selectedTask)
      setDispatchReason('')
      setFeedback({ tone: 'success', message: json.receipt?.missionId ? `Dispatch queued · ${json.receipt.missionId}` : 'Dispatch queued' })
    } catch (error) {
      setFeedback({ tone: 'error', message: error instanceof Error ? error.message : 'Dispatch request failed' })
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <section className={cn('rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-[0_24px_80px_var(--theme-shadow)]', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">Matrix board</div>
          <h2 className="mt-1 text-lg font-semibold text-[var(--theme-text)]">{MATRIX_BOARD_LABEL}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--theme-muted-2)]">
            The Matrix now opens on <code>all</code> boards, labels every card by its source board, and still lets you narrow back to <code>{MATRIX_DEFAULT_BOARD_SLUG}</code> or root when needed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--theme-muted)]">
          <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-1">{total} cards</span>
          {backendPresentation.dashboardUrl ? (
            <a
              href={backendPresentation.dashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20"
              title={`${backendPresentation.title ?? ''}\nOpen in Hermes Dashboard ↗`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {backendPresentation.badgeLabel}
              <span className="opacity-60" aria-hidden="true">↗</span>
            </a>
          ) : (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 font-medium',
                backendPresentation.badgeTone === 'claude'
                  ? 'border-violet-400/40 bg-violet-500/10 text-violet-700'
                  : backendPresentation.badgeTone === 'local'
                    ? 'border-amber-400/40 bg-amber-500/10 text-amber-700'
                    : 'border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-muted)]',
              )}
              title={backendPresentation.title}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', backendPresentation.badgeTone === 'claude' ? 'bg-violet-500' : backendPresentation.badgeTone === 'local' ? 'bg-amber-500' : 'bg-[var(--theme-muted)]')} />
              {backendPresentation.badgeLabel}
            </span>
          )}
          <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-1">{reviewCount} review</span>
          <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-1">{blockedCount} blocked</span>
          {doneWithFollowUpCount > 0 ? (
            <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-1 font-medium text-amber-700">{doneWithFollowUpCount} done slices have follow-up</span>
          ) : null}
          {doneMissingEvidenceCount > 0 ? (
            <span className="rounded-full border border-red-400/40 bg-red-500/10 px-2 py-1 font-medium text-red-700">{doneMissingEvidenceCount} done missing evidence</span>
          ) : null}
        </div>
      </div>

      {backendToast ? (
        <div className="fixed right-4 top-4 z-50 max-w-sm rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-4 py-3 text-sm text-[var(--theme-text)] shadow-[0_18px_60px_var(--theme-shadow)]" role="status" aria-live="polite">
          <div className="flex items-start gap-3">
            <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', backendToast.badgeTone === 'claude' ? 'bg-violet-500' : backendToast.badgeTone === 'local' ? 'bg-amber-500' : 'bg-[var(--theme-muted)]')} />
            <div>
              <div className="font-semibold">{backendToast.toastTitle}</div>
              <div className="mt-1 text-xs leading-relaxed text-[var(--theme-muted-2)]">{backendToast.toastBody}</div>
            </div>
            <button type="button" onClick={() => setBackendToast(null)} className="ml-1 rounded-full px-1.5 text-[var(--theme-muted)] hover:bg-[var(--theme-card2)] hover:text-[var(--theme-text)]" aria-label="Dismiss backend notice">×</button>
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-3 text-xs text-[var(--theme-muted)]">
        <label className="flex items-center gap-2">
          <span className="font-semibold text-[var(--theme-text)]">Board</span>
          <select
            value={selectedBoard?.slug ?? requestedBoard}
            onChange={(event) => {
              setRequestedBoard(event.target.value)
              setSelectedTask(null)
            }}
            className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card)] px-2 py-1 text-xs text-[var(--theme-text)] outline-none"
          >
            {boards.map((board) => (
              <option key={board.slug} value={board.slug}>
                {board.label} ({board.slug})
              </option>
            ))}
          </select>
        </label>
        <span className="rounded-full border border-[var(--theme-border)] px-2 py-1">
          Selected: <span className="font-semibold text-[var(--theme-text)]">{selectedBoard?.label ?? 'Loading…'}</span>
        </span>
        {selectedBoard?.fallback ? (
          <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-amber-700">
            Named board unavailable here — fell back safely.
          </span>
        ) : null}
        <span className="rounded-full border border-[var(--theme-border)] px-2 py-1">
          {readOnly ? 'Read-only drill-down' : 'Mutable'}
        </span>
      </div>

      {feedback ? (
        <div className={cn(
          'mb-3 rounded-2xl border px-4 py-3 text-sm',
          feedback.tone === 'error'
            ? 'border-red-400/40 bg-red-500/10 text-red-700'
            : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700',
        )}>
          {feedback.message}
        </div>
      ) : null}

      {!readOnly ? (
        <div className="mb-4 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">Bounded controls</div>
              <div className="mt-1 text-sm font-semibold text-[var(--theme-text)]">Create task</div>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--theme-muted-2)]">
                Matrix is the control plane: create, edit, assign, mark ready/blocked, comment, dispatch, reclaim, and reassign go through bounded Matrix receipts. Hermes Kanban remains execution/storage; direct running, review, terminal, and done stay worker-owned.
              </p>
            </div>
            <span className="rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--theme-muted)]">
              Safe actions only
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <label className="space-y-1 text-xs text-[var(--theme-muted)]">
              <span className="font-semibold text-[var(--theme-text)]">Title</span>
              <input
                value={createTitle}
                onChange={(event) => setCreateTitle(event.target.value)}
                placeholder="Bounded slice title"
                className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none"
              />
            </label>
            <label className="space-y-1 text-xs text-[var(--theme-muted)]">
              <span className="font-semibold text-[var(--theme-text)]">Assignee</span>
              <select
                value={createAssignee}
                onChange={(event) => setCreateAssignee(event.target.value)}
                className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none"
              >
                <option value="">Unassigned</option>
                {supportedAssignees.map((assignee) => (
                  <option key={assignee.id} value={assignee.id}>
                    {assignee.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-3 block space-y-1 text-xs text-[var(--theme-muted)]">
            <span className="font-semibold text-[var(--theme-text)]">Body / scope</span>
            <textarea
              value={createBody}
              onChange={(event) => setCreateBody(event.target.value)}
              rows={4}
              placeholder="Scope, constraints, acceptance criteria"
              className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!createTitle.trim() || pendingAction === 'create_task'}
              onClick={() => runControlAction({
                action: 'create_task',
                board: mutableBoard,
                title: createTitle.trim(),
                body: createBody,
                assignedWorker: createAssignee || null,
                status: 'backlog',
              }, 'Draft task created')}
              className="rounded-full border border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--theme-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pendingAction === 'create_task' ? 'Creating…' : 'Create draft'}
            </button>
            <button
              type="button"
              disabled={!createTitle.trim() || pendingAction === 'create_task'}
              onClick={() => runControlAction({
                action: 'create_task',
                board: mutableBoard,
                title: createTitle.trim(),
                body: createBody,
                assignedWorker: createAssignee || null,
                status: 'ready',
                reason: 'Created directly into ready from bounded Matrix controls.',
              }, 'Ready task created')}
              className="rounded-full border border-blue-400/40 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create ready
            </button>
          </div>
        </div>
      ) : null}

      {query.isError ? (
        <div className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">Kanban failed to load: {query.error.message}</div>
      ) : query.isPending ? (
        <div className="mb-3 rounded-2xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 text-sm text-[var(--theme-muted)]">
          Loading board cards and backend source…
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3 2xl:grid-cols-6">
        {LANES.map((lane) => {
          const laneCards = cardsByLane.get(lane.id) ?? []
          return (
            <div key={lane.id} className="min-h-64 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-2">
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]', LANE_TONE[lane.id])}>{lane.label}</span>
                    <span className="text-[10px] text-[var(--theme-muted)]">{laneCards.length}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--theme-muted)]">{lane.hint}</div>
                </div>
              </div>
              <div className="space-y-2">
                {query.isPending ? (
                  <div className="rounded-xl border border-dashed border-[var(--theme-border)] p-3 text-xs text-[var(--theme-muted)]">Waiting for source…</div>
                ) : laneCards.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--theme-border)] p-3 text-xs text-[var(--theme-muted)]">Empty</div>
                ) : laneCards.map((card) => {
                  const cardBoardSlug = card.boardSlug ?? selectedBoard?.slug ?? requestedBoard
                  const cardBoardLabel = card.boardLabel ?? selectedBoard?.label ?? cardBoardSlug
                  return (
                  <button
                    key={`${cardBoardSlug}:${card.id}`}
                    type="button"
                    onClick={() => setSelectedTask({ id: card.id, boardSlug: cardBoardSlug, boardLabel: cardBoardLabel })}
                    className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 text-left shadow-sm transition hover:border-[var(--theme-border2)] hover:bg-[var(--theme-card2)]"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className={cn('min-w-0 truncate rounded-full border px-2 py-0.5 text-[10px] font-semibold', getBoardBadgeTone(cardBoardSlug))} title={cardBoardSlug}>
                        {cardBoardLabel}
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--theme-muted)]">{card.status}</span>
                    </div>
                    <div className="text-sm font-semibold leading-snug text-[var(--theme-text)]">{card.title}</div>
                    {card.doneAudit?.warnings.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {card.doneAudit.openChildCount > 0 ? (
                          <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-700">
                            Slice done · {card.doneAudit.openChildCount} follow-up open/blocked
                          </span>
                        ) : null}
                        {doneAuditLacksEvidence(card.doneAudit) ? (
                          <span className="rounded-full border border-red-400/40 bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-700">
                            Done lacks completion evidence
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {card.spec ? <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[var(--theme-muted-2)]">{card.spec}</p> : null}
                    {card.latestSummary ? (
                      <div className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-2 text-[11px] leading-relaxed text-emerald-800">
                        <div className="font-semibold uppercase tracking-[0.12em]">Latest handoff</div>
                        <div className="mt-1 line-clamp-3 whitespace-pre-wrap">{card.latestSummary}</div>
                      </div>
                    ) : null}
                    <div className="mt-3 space-y-1 text-[10px] text-[var(--theme-muted)]">
                      <div>Assignee: <span className="font-semibold text-[var(--theme-text)]">{labelForWorker(card.assignedWorker)}</span></div>
                      <div>Profile: <span className="font-semibold text-[var(--theme-text)]">{card.createdBy || '—'}</span></div>
                      <div>Updated: <span className="font-semibold text-[var(--theme-text)]">{formatTimestamp(card.updatedAt)}</span></div>
                      {card.reportPath ? <div className="truncate" title={card.reportPath}>Report: {card.reportPath}</div> : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {card.assignedWorker ? (
                        <span className="rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] font-semibold text-[var(--theme-muted)]">
                          Open {labelForWorker(card.assignedWorker)}
                        </span>
                      ) : null}
                      <span className="rounded-full border border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--theme-accent-strong)]">
                        Drill down
                      </span>
                    </div>
                  </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {selectedTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-[var(--theme-border2)] bg-[var(--theme-card)] p-5 shadow-[0_30px_100px_var(--theme-shadow)]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">Task drill-down</div>
                <h3 className="mt-1 text-lg font-semibold text-[var(--theme-text)]">{detail?.title ?? selectedTask.id}</h3>
                <p className="mt-1 text-xs text-[var(--theme-muted-2)]">
                  Board: <span className={cn('rounded-full border px-2 py-0.5 font-semibold', getBoardBadgeTone(detail?.board ?? selectedTask.boardSlug))} title={detail?.board ?? selectedTask.boardSlug}>{selectedTask.boardLabel}</span> · Canonical status first, bounded Matrix controls second.
                </p>
              </div>
              <button type="button" onClick={() => setSelectedTask(null)} className="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-card2)] px-3 py-1.5 text-sm text-[var(--theme-muted)] hover:text-[var(--theme-text)]">Close</button>
            </div>

            {detailQuery.isLoading ? (
              <div className="rounded-2xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 text-sm text-[var(--theme-muted)]">Loading task detail…</div>
            ) : detailQuery.isError ? (
              <div className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">Task detail failed to load: {detailQuery.error.message}</div>
            ) : detail ? (
              <div className="space-y-4">
                <div className={cn('rounded-2xl border p-4 text-sm', controlState.tone)}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em]">Canonical control state</div>
                      <div className="mt-1 text-base font-semibold">{controlState.label}</div>
                    </div>
                    {latestReceipt?.mutationId ? (
                      <span className="rounded-full border border-current/20 px-2 py-1 text-[10px] uppercase tracking-[0.14em]">
                        receipt {latestReceipt.mutationId}
                      </span>
                    ) : null}
                  </div>
                  {controlState.note ? <p className="mt-2 text-xs leading-relaxed">{controlState.note}</p> : null}
                  {acceptanceMissingFields.length > 0 && claimEvidence ? (
                    <div className="mt-2 text-xs">
                      Missing acceptance fields: <span className="font-semibold">{acceptanceMissingFields.join(', ')}</span>
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3 text-xs">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--theme-muted)]">Status</div>
                    <div className="mt-1 font-semibold text-[var(--theme-text)]">{detail.status}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3 text-xs">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--theme-muted)]">Assignee</div>
                    <div className="mt-1 font-semibold text-[var(--theme-text)]">{labelForWorker(detail.assignee)}</div>
                    {unsupportedCurrentAssignee ? (
                      <div className="mt-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-700">
                        Dispatch disabled: {unsupportedCurrentAssignee.dispatchReason ?? `Assignee ${unsupportedCurrentAssignee.id} is not dispatchable from The Matrix.`}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3 text-xs">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--theme-muted)]">Owner/Profile</div>
                    <div className="mt-1 font-semibold text-[var(--theme-text)]">{detail.createdBy ?? '—'}</div>
                  </div>
                  <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3 text-xs">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--theme-muted)]">Current run</div>
                    <div className="mt-1 font-semibold text-[var(--theme-text)]">{detail.currentRunId ?? '—'}</div>
                  </div>
                </div>

                {detail.doneAudit?.warnings.length ? (
                  <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-xs text-amber-800">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em]">Done semantics guard</div>
                    <div className="mt-2 space-y-1">
                      {detail.doneAudit.warnings.map((warning) => (
                        <div key={warning}>• {warning}</div>
                      ))}
                      <div>Completion events: <span className="font-semibold">{detail.doneAudit.completedEventCount}</span></div>
                      <div>Completed runs: <span className="font-semibold">{detail.doneAudit.completedRunCount}</span></div>
                    </div>
                    {detail.doneAudit.openChildren.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        <div className="font-semibold">Open linked follow-up</div>
                        {detail.doneAudit.openChildren.map((child) => (
                          <div key={child.id} className="rounded-xl border border-amber-400/30 bg-[var(--theme-card)] p-2 text-[11px] text-[var(--theme-text)]">
                            <div className="font-semibold">{child.title}</div>
                            <div className="mt-1 text-[var(--theme-muted)]">{child.id} · {child.status} · {child.assignee ?? 'unassigned'}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {!readOnly ? (
                  <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">Bounded task controls</div>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--theme-muted-2)]">
                      Only safe task-bound actions are available here. Direct running, review, terminal, and done actions remain intentionally absent.
                    </p>
                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div className="space-y-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
                        <div className="text-sm font-semibold text-[var(--theme-text)]">Edit task content</div>
                        <label className="space-y-1 text-xs text-[var(--theme-muted)]">
                          <span className="font-semibold text-[var(--theme-text)]">Title</span>
                          <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none" />
                        </label>
                        <label className="space-y-1 text-xs text-[var(--theme-muted)]">
                          <span className="font-semibold text-[var(--theme-text)]">Body</span>
                          <textarea value={editBody} onChange={(event) => setEditBody(event.target.value)} rows={5} className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none" />
                        </label>
                        <label className="space-y-1 text-xs text-[var(--theme-muted)]">
                          <span className="font-semibold text-[var(--theme-text)]">Reason</span>
                          <input value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="Why is this edit or route change safe?" className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none" />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={!canEditTask || !editTitle.trim() || pendingAction === 'edit_task'}
                            onClick={() => runControlAction({ action: 'edit_task', board: detail.board, taskId: detail.id, title: editTitle.trim(), body: editBody, reason: actionReason.trim() || undefined }, 'Task content updated', selectedTask)}
                            className="rounded-full border border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--theme-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Save task content
                          </button>
                          <button
                            type="button"
                            disabled={!canMarkReady || pendingAction === 'mark_ready'}
                            onClick={() => runControlAction({ action: 'mark_ready', board: detail.board, taskId: detail.id, reason: actionReason.trim() || 'Marked ready from Matrix bounded controls.' }, 'Task marked ready', selectedTask)}
                            className="rounded-full border border-blue-400/40 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Mark ready
                          </button>
                          <button
                            type="button"
                            disabled={!canMarkBlocked || pendingAction === 'mark_blocked'}
                            onClick={() => runControlAction({ action: 'mark_blocked', board: detail.board, taskId: detail.id, reason: actionReason.trim() || 'Blocked from Matrix bounded controls.' }, 'Task marked blocked', selectedTask)}
                            className="rounded-full border border-red-400/40 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Mark blocked
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
                        <div className="text-sm font-semibold text-[var(--theme-text)]">Assign and route</div>
                        <label className="space-y-1 text-xs text-[var(--theme-muted)]">
                          <span className="font-semibold text-[var(--theme-text)]">Assignee</span>
                          <select value={assignWorkerId} onChange={(event) => setAssignWorkerId(event.target.value)} className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none">
                            <option value="">Unassigned</option>
                            {supportedAssignees.map((assignee) => (
                              <option key={assignee.id} value={assignee.id}>{assignee.label}</option>
                            ))}
                          </select>
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={!canAssignWorker || pendingAction === 'assign_task'}
                            onClick={() => runControlAction({ action: 'assign_task', board: detail.board, taskId: detail.id, assignedWorker: assignWorkerId || null, reason: actionReason.trim() || undefined }, assignWorkerId ? `Assigned ${labelForWorker(assignWorkerId)}` : 'Task unassigned', selectedTask)}
                            className="rounded-full border border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--theme-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Assign worker
                          </button>
                          <button
                            type="button"
                            disabled={!canReclaim || pendingAction === 'reclaim_worker' || !reclaimReason.trim()}
                            onClick={() => runControlAction({ action: 'reclaim_worker', board: detail.board, taskId: detail.id, reason: reclaimReason.trim() }, 'Worker reclaimed back to backlog', selectedTask)}
                            className="rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Reclaim
                          </button>
                        </div>
                        <label className="space-y-1 text-xs text-[var(--theme-muted)]">
                          <span className="font-semibold text-[var(--theme-text)]">Routing comment</span>
                          <textarea value={routingComment} onChange={(event) => setRoutingComment(event.target.value)} rows={4} placeholder="Rationale, blocker note, dependency note, dispatch intent" className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none" />
                        </label>
                        <button
                          type="button"
                          disabled={!routingComment.trim() || pendingAction === 'add_comment'}
                          onClick={() => runControlAction({ action: 'add_comment', board: detail.board, taskId: detail.id, comment: routingComment.trim(), reason: actionReason.trim() || undefined }, 'Routing comment added', selectedTask)}
                          className="rounded-full border border-[var(--theme-border)] px-3 py-1.5 text-xs font-semibold text-[var(--theme-muted)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Add routing comment
                        </button>
                      </div>

                      <div className="space-y-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
                        <div className="text-sm font-semibold text-[var(--theme-text)]">Dispatch request</div>
                        <p className="text-xs leading-relaxed text-[var(--theme-muted-2)]">
                          Dispatch does not require prior acceptance here. It stays queued until canonical claim evidence appears, then shifts to acceptance pending until the specialist writes the acceptance fields.
                        </p>
                        <label className="space-y-1 text-xs text-[var(--theme-muted)]">
                          <span className="font-semibold text-[var(--theme-text)]">Dispatch reason</span>
                          <input value={dispatchReason} onChange={(event) => setDispatchReason(event.target.value)} placeholder="Why this worker, why now" className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none" />
                        </label>
                        {!detail.assignee?.trim() ? <div className="text-xs text-amber-700">Assign a worker before dispatch.</div> : null}
                        {!taskHasUsableScope(detail) ? <div className="text-xs text-amber-700">Add task title/body scope before dispatch.</div> : null}
                        <button
                          type="button"
                          disabled={!canDispatch || pendingAction === 'request_dispatch'}
                          onClick={runDispatchRequest}
                          className="rounded-full border border-blue-400/40 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {pendingAction === 'request_dispatch' ? 'Queueing…' : 'Request dispatch'}
                        </button>
                        {latestReceipt ? (
                          <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-3 text-xs text-[var(--theme-muted)]">
                            <div>Mission: <span className="font-semibold text-[var(--theme-text)]">{latestReceipt.missionId ?? '—'}</span></div>
                            <div>Assignment: <span className="font-semibold text-[var(--theme-text)]">{latestReceipt.assignmentId ?? '—'}</span></div>
                            <div>Delivery: <span className="font-semibold text-[var(--theme-text)]">{latestReceipt.delivery ?? '—'}</span></div>
                            <div>Outcome: <span className="font-semibold text-[var(--theme-text)]">{controlState.label}</span></div>
                          </div>
                        ) : null}
                      </div>

                      <div className="space-y-3 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4">
                        <div className="text-sm font-semibold text-[var(--theme-text)]">Reassign worker</div>
                        <p className="text-xs leading-relaxed text-[var(--theme-muted-2)]">Reassign and reclaim remain pre-claim controls only. Once canonical claim/run evidence exists, Matrix must stop here.</p>
                        <label className="space-y-1 text-xs text-[var(--theme-muted)]">
                          <span className="font-semibold text-[var(--theme-text)]">New assignee</span>
                          <select value={reassignWorkerId} onChange={(event) => setReassignWorkerId(event.target.value)} className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none">
                            <option value="">Choose worker</option>
                            {supportedAssignees.map((assignee) => (
                              <option key={assignee.id} value={assignee.id}>{assignee.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1 text-xs text-[var(--theme-muted)]">
                          <span className="font-semibold text-[var(--theme-text)]">Reassign reason</span>
                          <textarea value={reassignReason} onChange={(event) => setReassignReason(event.target.value)} rows={3} placeholder="Why the current assignee is no longer the right lane" className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none" />
                        </label>
                        <label className="space-y-1 text-xs text-[var(--theme-muted)]">
                          <span className="font-semibold text-[var(--theme-text)]">Reclaim reason</span>
                          <textarea value={reclaimReason} onChange={(event) => setReclaimReason(event.target.value)} rows={3} placeholder="Why this should go back to backlog/unassigned" className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none" />
                        </label>
                        <button
                          type="button"
                          disabled={!canReclaim || !reassignWorkerId.trim() || !reassignReason.trim() || pendingAction === 'reassign_worker'}
                          onClick={() => runControlAction({ action: 'reassign_worker', board: detail.board, taskId: detail.id, assignedWorker: reassignWorkerId.trim(), reason: reassignReason.trim() }, `Reassigned to ${labelForWorker(reassignWorkerId.trim())}`, selectedTask)}
                          className="rounded-full border border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--theme-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Reassign worker
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-4 text-sm text-[var(--theme-muted)]">
                    This board is read-only in the current backend. Matrix can still surface canonical receipts, warnings, and worker evidence here.
                  </div>
                )}

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">Body preview</div>
                      <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--theme-text)]">{detail.body || 'No task body recorded.'}</pre>
                    </div>
                    {detail.result ? (
                      <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-4">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">Result / handoff</div>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--theme-text)]">{detail.result}</pre>
                      </div>
                    ) : null}
                    <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">Comments</div>
                      <div className="mt-2 space-y-3">
                        {detail.comments.length === 0 ? (
                          <div className="text-xs text-[var(--theme-muted)]">No comments recorded on this board.</div>
                        ) : detail.comments.map((comment, index) => (
                          <div key={`${comment.author ?? 'comment'}-${index}`} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-[var(--theme-muted)]">
                              <span>{comment.author ?? 'Unknown author'}</span>
                              <span>{formatTimestamp(comment.createdAt)}</span>
                            </div>
                            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--theme-text)]">{comment.body}</pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-4 text-xs text-[var(--theme-text)]">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">Control receipts</div>
                      <div className="mt-2 space-y-3">
                        {detail.controlReceipts.length === 0 ? (
                          <div className="text-xs text-[var(--theme-muted)]">No Matrix-origin control receipts are recorded for this task yet.</div>
                        ) : detail.controlReceipts.map((receipt, index) => (
                          <div key={`${receipt.mutationId ?? receipt.kind}-${index}`} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold text-[var(--theme-text)]">{receipt.kind === 'matrix_dispatch_receipt' ? 'Dispatch receipt' : 'Control receipt'}</span>
                              <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--theme-muted)]">{formatTimestamp(receipt.createdAt)}</span>
                            </div>
                            <div className="mt-2 space-y-1 text-[11px] text-[var(--theme-muted)]">
                              <div>Mutation: <span className="text-[var(--theme-text)]">{receipt.mutationId ?? '—'}</span></div>
                              <div>Action: <span className="text-[var(--theme-text)]">{receipt.action ?? '—'}</span></div>
                              <div>Actor: <span className="text-[var(--theme-text)]">{receipt.actor ?? '—'}</span></div>
                              {receipt.missionId ? <div>Mission: <span className="text-[var(--theme-text)]">{receipt.missionId}</span></div> : null}
                              {receipt.assignmentId ? <div>Assignment: <span className="text-[var(--theme-text)]">{receipt.assignmentId}</span></div> : null}
                              {receipt.workerId ? <div>Worker: <span className="text-[var(--theme-text)]">{receipt.workerId}</span></div> : null}
                              {receipt.delivery ? <div>Delivery: <span className="text-[var(--theme-text)]">{receipt.delivery}</span></div> : null}
                              {receipt.stateAfter ? <div>State after: <span className="text-[var(--theme-text)]">{receipt.stateAfter}</span></div> : null}
                              {receipt.reason ? <div>Reason: <span className="text-[var(--theme-text)]">{receipt.reason}</span></div> : null}
                              {receipt.detail ? <div>Detail: <span className="text-[var(--theme-text)]">{receipt.detail}</span></div> : null}
                              {receipt.error ? <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-red-400/40 bg-red-500/10 p-2 text-xs text-red-700">{receipt.error}</pre> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-4 text-xs text-[var(--theme-text)]">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">Workspace</div>
                      <div className="mt-2 space-y-2">
                        <div><span className="text-[var(--theme-muted)]">Kind:</span> {detail.workspaceKind ?? '—'}</div>
                        <div><span className="text-[var(--theme-muted)]">Path:</span> <span className="break-all">{detail.workspacePath ?? '—'}</span></div>
                        <div><span className="text-[var(--theme-muted)]">Created:</span> {formatTimestamp(detail.createdAt)}</div>
                        <div><span className="text-[var(--theme-muted)]">Started:</span> {formatTimestamp(detail.startedAt)}</div>
                        <div><span className="text-[var(--theme-muted)]">Completed:</span> {formatTimestamp(detail.completedAt)}</div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">Recent runs</div>
                      <div className="mt-2 space-y-3">
                        {detail.recentRuns.length === 0 ? (
                          <div className="text-xs text-[var(--theme-muted)]">No run history exposed for this board.</div>
                        ) : detail.recentRuns.map((run) => (
                          <div key={run.id} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold text-[var(--theme-text)]">Run {run.id}</span>
                              <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--theme-muted)]">{run.status ?? run.outcome ?? 'unknown'}</span>
                            </div>
                            <div className="mt-2 space-y-1 text-[11px] text-[var(--theme-muted)]">
                              <div>Outcome: <span className="text-[var(--theme-text)]">{run.outcome ?? '—'}</span></div>
                              <div>Started: <span className="text-[var(--theme-text)]">{formatTimestamp(run.startedAt)}</span></div>
                              <div>Ended: <span className="text-[var(--theme-text)]">{formatTimestamp(run.endedAt)}</span></div>
                              {run.summary ? <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--theme-text)]">{run.summary}</pre> : null}
                              {run.error ? <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-red-400/40 bg-red-500/10 p-2 text-xs text-red-700">{run.error}</pre> : null}
                              {formatMetadata(run.metadata) ? <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg)] p-2 text-[11px] text-[var(--theme-muted)]">{formatMetadata(run.metadata)}</pre> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {detail.assignee ? (
                    <button type="button" onClick={() => onSelectWorker?.(detail.assignee!)} className="rounded-full border border-[var(--theme-border)] px-3 py-1.5 text-xs font-semibold text-[var(--theme-muted)] hover:bg-[var(--theme-card2)] hover:text-[var(--theme-text)]">
                      Open worker
                    </button>
                  ) : null}
                  {onOpenRouter ? (
                    <button type="button" onClick={onOpenRouter} className="rounded-full border border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--theme-accent-strong)]">
                      Router
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 text-sm text-[var(--theme-muted)]">Task detail not available for this board.</div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
