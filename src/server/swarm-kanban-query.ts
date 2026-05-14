import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { MATRIX_DEFAULT_BOARD_SLUG } from '../lib/matrix-branding'
import { getClaudeRoot } from './claude-paths'
import {
  
  fetchDashboardKanbanBoard,
  fetchDashboardKanbanTask,
  listDashboardKanbanBoards
} from './kanban-dashboard-proxy'
import { getCapabilities } from './gateway-capabilities'
import { getKanbanBackendMeta } from './kanban-backend'
import {
  ACCEPTANCE_FIELDS,
  findTaskAcceptance,
  parseShippingGovernorMeta,
  summarizeShippingGovernorPortfolio,
} from './swarm-kanban-canonical'
import type { ShippingGovernorMeta, ShippingGovernorSummary } from './swarm-kanban-canonical'
import { SWARM_KANBAN_FILE, listSwarmKanbanCards } from './swarm-kanban-store'
import type { KanbanBackendMeta } from './kanban-backend'
import type { DashboardKanbanBoard } from './kanban-dashboard-proxy'
import type { SwarmKanbanCard } from './swarm-kanban-store'

export type SwarmKanbanBoardOption = {
  slug: string
  label: string
  description: string | null
  available: boolean
  current: boolean
  source: 'aggregate' | 'dashboard' | 'sqlite' | 'local'
}

export type SwarmKanbanSelectedBoard = {
  requested: string | null
  slug: string
  label: string
  description: string | null
  fallback: boolean
}

export type SwarmKanbanCardBoardMeta = {
  boardSlug: string
  boardLabel: string
  boardSource: SwarmKanbanBoardOption['source']
}

export type SwarmKanbanOpenChild = {
  id: string
  title: string
  status: string
  assignee: string | null
}

export type SwarmKanbanDoneAudit = {
  openChildCount: number
  openChildren: Array<SwarmKanbanOpenChild>
  completedEventCount: number
  completedRunCount: number
  warnings: Array<string>
}

export type SwarmKanbanCardWithBoard = SwarmKanbanCard & SwarmKanbanCardBoardMeta & {
  doneAudit: SwarmKanbanDoneAudit | null
  shipping: ShippingGovernorMeta | null
}

export type SwarmKanbanTaskComment = {
  author: string | null
  body: string
  createdAt: number | null
}

export type SwarmKanbanTaskRun = {
  id: number
  status: string | null
  outcome: string | null
  summary: string | null
  metadata: string | null
  error: string | null
  startedAt: number | null
  endedAt: number | null
}

export type SwarmKanbanTaskAcceptance = Partial<Record<(typeof ACCEPTANCE_FIELDS)[number], string>>

export type SwarmKanbanControlReceipt = {
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
  state: 'queued' | 'claimed-spawned' | 'accepted' | 'failed' | null
  acceptancePending: boolean | null
  checkpointStatus: string | null
  stateAfter: string | null
  error: string | null
}

export type SwarmKanbanTaskDetail = {
  id: string
  board: string
  title: string
  status: string
  lane: SwarmKanbanCard['status']
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
  comments: Array<SwarmKanbanTaskComment>
  recentRuns: Array<SwarmKanbanTaskRun>
  acceptance: SwarmKanbanTaskAcceptance | null
  controlReceipts: Array<SwarmKanbanControlReceipt>
  doneAudit: SwarmKanbanDoneAudit | null
  shipping: ShippingGovernorMeta | null
}

type SqliteTaskRow = {
  id: string
  title: string
  body?: string | null
  assignee?: string | null
  status?: string | null
  created_by?: string | null
  created_at?: number | string | null
  started_at?: number | string | null
  completed_at?: number | string | null
  workspace_kind?: string | null
  workspace_path?: string | null
  current_run_id?: number | null
  result?: string | null
  latest_summary?: string | null
}

type SqliteCommentRow = {
  author?: string | null
  body?: string | null
  created_at?: number | string | null
}

type SqliteRunRow = {
  id: number
  status?: string | null
  outcome?: string | null
  summary?: string | null
  metadata?: string | null
  error?: string | null
  started_at?: number | string | null
  ended_at?: number | string | null
}

type SqliteEventRow = {
  kind?: string | null
  payload?: string | null
  created_at?: number | string | null
}

type SqliteDoneAuditRow = {
  task_id: string
  open_children?: string | null
  open_child_count?: number | string | null
  completed_event_count?: number | string | null
  completed_run_count?: number | string | null
}

type ResolvedBoard = SwarmKanbanSelectedBoard & {
  dbPath: string | null
  source: SwarmKanbanBoardOption['source']
}

const ALL_BOARDS_SLUG = 'all'

function normalizeBoardSlug(input: string | null | undefined): string | null {
  const value = input?.trim().toLowerCase()
  if (!value) return null
  if (value === ALL_BOARDS_SLUG || value === 'boards' || value === 'aggregate') return ALL_BOARDS_SLUG
  if (value === 'root' || value === 'main') return 'default'
  if (value === 'matrix' || value === 'the-matrix') return MATRIX_DEFAULT_BOARD_SLUG
  return value
}

function boardLabel(slug: string, fallbackName?: string | null): string {
  if (slug === MATRIX_DEFAULT_BOARD_SLUG) return 'The Matrix'
  if (slug === 'default') return 'Root board'
  if (fallbackName?.trim()) return fallbackName.trim()
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function hermesBoardRoot(): string {
  return path.join(getClaudeRoot(), 'kanban', 'boards')
}

function rootKanbanDbPath(): string {
  return path.join(getClaudeRoot(), 'kanban.db')
}

function boardDbPath(slug: string): string | null {
  if (slug === 'default') return fs.existsSync(rootKanbanDbPath()) ? rootKanbanDbPath() : null
  const candidate = path.join(hermesBoardRoot(), slug, 'kanban.db')
  return fs.existsSync(candidate) ? candidate : null
}

function sqliteJson<T>(dbPath: string, sql: string): T {
  const raw = execFileSync('sqlite3', [dbPath, '-json', sql], {
    encoding: 'utf8',
    timeout: 15_000,
  }).trim()
  return (raw ? JSON.parse(raw) : []) as T
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : Math.round(value * 1000)
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return normalizeTimestamp(numeric)
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function toNullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function mapStatusToLane(status: string | null | undefined): SwarmKanbanCard['status'] {
  switch ((status ?? '').toLowerCase()) {
    case 'triage':
    case 'todo':
    case 'queued':
      return 'backlog'
    case 'ready':
      return 'ready'
    case 'running':
    case 'claimed':
    case 'in_progress':
      return 'running'
    case 'review':
      return 'review'
    case 'blocked':
      return 'blocked'
    case 'done':
    case 'complete':
    case 'completed':
      return 'done'
    default:
      return 'backlog'
  }
}

function sqliteTaskToCard(task: SqliteTaskRow): SwarmKanbanCard {
  return {
    id: task.id,
    title: task.title,
    spec: task.body ?? '',
    acceptanceCriteria: [],
    assignedWorker: task.assignee ?? null,
    reviewer: null,
    status: mapStatusToLane(task.status),
    missionId: null,
    reportPath: null,
    latestSummary: task.latest_summary ?? task.result ?? null,
    createdBy: task.created_by ?? 'hermes-kanban',
    createdAt: normalizeTimestamp(task.created_at) ?? Date.now(),
    updatedAt:
      normalizeTimestamp(task.completed_at) ??
      normalizeTimestamp(task.started_at) ??
      normalizeTimestamp(task.created_at) ??
      Date.now(),
  }
}

function toCount(value: number | string | null | undefined): number {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function parseOpenChildren(value: string | null | undefined): Array<SwarmKanbanOpenChild> {
  if (!value) return []
  return value
    .split('\u001e')
    .filter(Boolean)
    .map((entry) => {
      const [id = '', title = '', status = '', assignee = ''] = entry.split('\u001f')
      return {
        id,
        title,
        status,
        assignee: assignee || null,
      }
    })
}

function doneAuditFromRow(row: SqliteDoneAuditRow | undefined): SwarmKanbanDoneAudit | null {
  if (!row) return null
  const openChildren = parseOpenChildren(row.open_children)
  const openChildCount = toCount(row.open_child_count) || openChildren.length
  const completedEventCount = toCount(row.completed_event_count)
  const completedRunCount = toCount(row.completed_run_count)
  const warnings: Array<string> = []
  if (openChildCount > 0) {
    warnings.push(`Slice done; ${openChildCount} linked follow-up task${openChildCount === 1 ? '' : 's'} still open/blocked.`)
  }
  if (completedEventCount === 0 && completedRunCount === 0) {
    warnings.push('Done has no completed run/event evidence exposed by the canonical Kanban DB.')
  }
  return {
    openChildCount,
    openChildren,
    completedEventCount,
    completedRunCount,
    warnings,
  }
}

function doneAuditSql(whereClause: string): string {
  return [
    'select p.id as task_id,',
    "coalesce(group_concat(c.id || char(31) || replace(coalesce(c.title, ''), char(30), ' ') || char(31) || coalesce(c.status, '') || char(31) || coalesce(c.assignee, ''), char(30)), '') as open_children,",
    'count(c.id) as open_child_count,',
    "(select count(*) from task_events e where e.task_id = p.id and e.kind = 'completed') as completed_event_count,",
    "(select count(*) from task_runs r where r.task_id = p.id and (r.status in ('completed','done','success') or r.outcome in ('completed','done','success'))) as completed_run_count",
    'from tasks p',
    'left join task_links l on l.parent_id = p.id',
    "left join tasks c on c.id = l.child_id and c.status not in ('done', 'archived')",
    whereClause,
    'group by p.id;',
  ].join(' ')
}

function doneAuditForTask(dbPath: string, taskId: string, status: string | null | undefined): SwarmKanbanDoneAudit | null {
  if ((status ?? '').toLowerCase() !== 'done') return null
  const safeTaskId = taskId.replace(/'/g, "''")
  const rows = sqliteJson<Array<SqliteDoneAuditRow>>(dbPath, doneAuditSql(`where p.id = '${safeTaskId}' and p.status = 'done'`))
  return doneAuditFromRow(rows[0])
}

function doneAuditMapForBoard(dbPath: string): Map<string, SwarmKanbanDoneAudit> {
  const rows = sqliteJson<Array<SqliteDoneAuditRow>>(dbPath, doneAuditSql("where p.status = 'done'"))
  return new Map(
    rows
      .map((row) => [row.task_id, doneAuditFromRow(row)] as const)
      .filter((entry): entry is readonly [string, SwarmKanbanDoneAudit] => Boolean(entry[1])),
  )
}

function parseControlReceipt(event: SqliteEventRow): SwarmKanbanControlReceipt | null {
  const kind = event.kind === 'matrix_dispatch_receipt' || event.kind === 'matrix_control' ? event.kind : null
  if (!kind) return null
  const payload = parseJsonRecord(event.payload)
  const state = toNullableString(payload?.state)
  return {
    kind,
    createdAt: normalizeTimestamp(event.created_at),
    mutationId: toNullableString(payload?.mutationId),
    actor: toNullableString(payload?.actor),
    reason: toNullableString(payload?.reason),
    action: toNullableString(payload?.action),
    detail: toNullableString(payload?.detail),
    taskId: toNullableString(payload?.taskId),
    missionId: toNullableString(payload?.missionId),
    assignmentId: toNullableString(payload?.assignmentId),
    workerId: toNullableString(payload?.workerId),
    delivery: toNullableString(payload?.delivery),
    ok: toNullableBoolean(payload?.ok),
    state:
      state === 'queued' || state === 'claimed-spawned' || state === 'accepted' || state === 'failed'
        ? state
        : null,
    acceptancePending: toNullableBoolean(payload?.acceptancePending),
    checkpointStatus: toNullableString(payload?.checkpointStatus),
    stateAfter: toNullableString(payload?.stateAfter),
    error: toNullableString(payload?.error),
  }
}

function summarizeAcceptance(acceptance: ReturnType<typeof findTaskAcceptance>): SwarmKanbanTaskAcceptance | null {
  return acceptance ? { ...acceptance } : null
}

function withBoardMeta(
  card: SwarmKanbanCard,
  board: Pick<SwarmKanbanBoardOption, 'slug' | 'label' | 'source'>,
  doneAudit: SwarmKanbanDoneAudit | null = null,
  shipping: ShippingGovernorMeta | null = null,
): SwarmKanbanCardWithBoard {
  return {
    ...card,
    boardSlug: board.slug,
    boardLabel: board.label,
    boardSource: board.source,
    doneAudit,
    shipping,
  }
}

function aggregateBoardOption(boards: Array<SwarmKanbanBoardOption>): SwarmKanbanBoardOption {
  return {
    slug: ALL_BOARDS_SLUG,
    label: 'All boards',
    description: `${boards.length} discovered board${boards.length === 1 ? '' : 's'}`,
    available: boards.length > 0,
    current: false,
    source: 'aggregate',
  }
}

function withAggregateOption(boards: Array<SwarmKanbanBoardOption>): Array<SwarmKanbanBoardOption> {
  return [aggregateBoardOption(boards), ...boards]
}

async function discoverBoards(): Promise<Array<SwarmKanbanBoardOption>> {
  if (getCapabilities().kanban) {
    const response = await listDashboardKanbanBoards()
    const boards = Array.isArray(response.boards) ? response.boards : []
    return boards.map((board: DashboardKanbanBoard & { name?: string | null; description?: string | null; is_current?: boolean }) => ({
      slug: board.slug,
      label: boardLabel(board.slug, board.name ?? board.display_name ?? null),
      description: board.description ?? null,
      available: true,
      current: Boolean(board.is_current) || response.current === board.slug,
      source: 'dashboard',
    }))
  }

  const boards: Array<SwarmKanbanBoardOption> = []
  if (fs.existsSync(rootKanbanDbPath())) {
    boards.push({
      slug: 'default',
      label: boardLabel('default'),
      description: 'Canonical root Hermes board',
      available: true,
      current: true,
      source: 'sqlite',
    })
  }

  const boardsRoot = hermesBoardRoot()
  if (fs.existsSync(boardsRoot)) {
    const entries = fs.readdirSync(boardsRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const slug = entry.name
      const dbPath = path.join(boardsRoot, slug, 'kanban.db')
      if (!fs.existsSync(dbPath)) continue
      boards.push({
        slug,
        label: boardLabel(slug),
        description: slug === MATRIX_DEFAULT_BOARD_SLUG ? 'Named The Matrix / Mission Control board' : null,
        available: true,
        current: false,
        source: 'sqlite',
      })
    }
  }

  if (boards.length > 0) return boards
  return [
    {
      slug: 'default',
      label: boardLabel('default'),
      description: 'Local swarm fallback board',
      available: true,
      current: true,
      source: 'local',
    },
  ]
}

async function resolveBoard(requestedBoard?: string | null): Promise<ResolvedBoard> {
  const requested = normalizeBoardSlug(requestedBoard)
  const boards = await discoverBoards()
  if (requested === ALL_BOARDS_SLUG) {
    return {
      requested,
      slug: ALL_BOARDS_SLUG,
      label: 'All boards',
      description: `${boards.length} discovered board${boards.length === 1 ? '' : 's'}`,
      fallback: false,
      dbPath: null,
      source: 'aggregate',
    }
  }
  const selected =
    (requested ? boards.find((board) => board.slug === requested) : undefined) ??
    boards.find((board) => board.slug === MATRIX_DEFAULT_BOARD_SLUG) ??
    boards.find((board) => board.slug === 'default') ??
    boards[0]

  return {
    requested,
    slug: selected.slug,
    label: selected.label,
    description: selected.description,
    fallback: Boolean(requested && requested !== selected.slug),
    dbPath: selected.source === 'sqlite' ? boardDbPath(selected.slug) : null,
    source: selected.source,
  }
}

export async function listSwarmKanbanBoards(): Promise<Array<SwarmKanbanBoardOption>> {
  return withAggregateOption(await discoverBoards())
}

function cardShipping(task: { body?: string | null }): ShippingGovernorMeta | null {
  return parseShippingGovernorMeta(task.body ?? null)
}

function boardShippingGovernor(cards: Array<SwarmKanbanCardWithBoard>): ShippingGovernorSummary {
  return summarizeShippingGovernorPortfolio(cards.map((card) => card.shipping))
}

async function cardsForBoard(board: SwarmKanbanBoardOption): Promise<Array<SwarmKanbanCardWithBoard>> {
  const localDbPath = boardDbPath(board.slug)
  if (localDbPath) {
    const rows = sqliteJson<Array<SqliteTaskRow>>(
      localDbPath,
      [
        'select id, title, body, assignee, status, created_by, created_at, started_at, completed_at, result,',
        "(select summary from task_runs r where r.task_id = tasks.id and r.summary is not null and trim(r.summary) != '' order by coalesce(r.ended_at, r.started_at, 0) desc, r.id desc limit 1) as latest_summary",
        'from tasks',
        'order by coalesce(completed_at, started_at, created_at) desc, id desc;',
      ].join(' '),
    )
    const doneAudits = doneAuditMapForBoard(localDbPath)
    return rows.map((row) => withBoardMeta(sqliteTaskToCard(row), board, doneAudits.get(row.id) ?? null, cardShipping(row)))
  }

  if (getCapabilities().kanban) {
    const response = await fetchDashboardKanbanBoard(board.slug)
    return response.columns.flatMap((column) => column.tasks.map((task) => withBoardMeta(sqliteTaskToCard(task), board, null, cardShipping(task))))
  }

  return listSwarmKanbanCards().map((card) => withBoardMeta(card, board))
}

export async function querySwarmKanbanBoard(input: {
  board?: string | null
  taskId?: string | null
}): Promise<{
  cards: Array<SwarmKanbanCardWithBoard>
  shippingGovernor: ShippingGovernorSummary
  backend: KanbanBackendMeta
  boards: Array<SwarmKanbanBoardOption>
  selectedBoard: SwarmKanbanSelectedBoard
  readOnly: boolean
  taskDetail: SwarmKanbanTaskDetail | null
}> {
  const boards = await discoverBoards()
  const resolved = await resolveBoard(input.board)
  const backend = getKanbanBackendMeta()

  let cards: Array<SwarmKanbanCardWithBoard>
  if (resolved.slug === ALL_BOARDS_SLUG) {
    cards = (await Promise.all(boards.map((board) => cardsForBoard(board)))).flat()
  } else {
    const selectedBoard = boards.find((board) => board.slug === resolved.slug) ?? {
      slug: resolved.slug,
      label: resolved.label,
      description: resolved.description,
      available: true,
      current: false,
      source: resolved.source,
    }
    cards = await cardsForBoard(selectedBoard)
  }
  cards.sort((a, b) => b.updatedAt - a.updatedAt || a.boardLabel.localeCompare(b.boardLabel) || a.title.localeCompare(b.title))
  const shippingGovernor = boardShippingGovernor(cards)
  const detailBoard = resolved.slug === ALL_BOARDS_SLUG && input.taskId
    ? cards.find((card) => card.id === input.taskId)?.boardSlug ?? resolved.slug
    : resolved.slug

  return {
    cards,
    shippingGovernor,
    backend,
    boards: withAggregateOption(boards),
    selectedBoard: {
      requested: resolved.requested,
      slug: resolved.slug,
      label: resolved.label,
      description: resolved.description,
      fallback: resolved.fallback,
    },
    readOnly: !(backend.writable && backend.id !== 'local'),
    taskDetail: input.taskId ? await getSwarmKanbanTaskDetail({ board: detailBoard, taskId: input.taskId }) : null,
  }
}

export async function getSwarmKanbanTaskDetail(input: {
  board?: string | null
  taskId: string
}): Promise<SwarmKanbanTaskDetail | null> {
  const resolved = await resolveBoard(input.board)
  const detailDbPath = resolved.dbPath ?? boardDbPath(resolved.slug)

  if (detailDbPath) {
    const taskRows = sqliteJson<Array<SqliteTaskRow>>(
      detailDbPath,
      [
        'select id, title, body, assignee, status, created_by, created_at, started_at, completed_at, workspace_kind, workspace_path, current_run_id, result,',
        "(select summary from task_runs r where r.task_id = tasks.id and r.summary is not null and trim(r.summary) != '' order by coalesce(r.ended_at, r.started_at, 0) desc, r.id desc limit 1) as latest_summary",
        'from tasks',
        `where id = '${input.taskId.replace(/'/g, "''")}'`,
        'limit 1;',
      ].join(' '),
    )
    if (taskRows.length === 0) return null
    const task = taskRows[0]
    const comments = sqliteJson<Array<SqliteCommentRow>>(
      detailDbPath,
      [
        'select author, body, created_at',
        'from task_comments',
        `where task_id = '${input.taskId.replace(/'/g, "''")}'`,
        'order by created_at desc',
        'limit 8;',
      ].join(' '),
    )
    const recentRuns = sqliteJson<Array<SqliteRunRow>>(
      detailDbPath,
      [
        'select id, status, outcome, summary, metadata, error, started_at, ended_at',
        'from task_runs',
        `where task_id = '${input.taskId.replace(/'/g, "''")}'`,
        'order by started_at desc, id desc',
        'limit 5;',
      ].join(' '),
    )
    const events = sqliteJson<Array<SqliteEventRow>>(
      detailDbPath,
      [
        'select kind, payload, created_at',
        'from task_events',
        `where task_id = '${input.taskId.replace(/'/g, "''")}' and kind in ('matrix_control', 'matrix_dispatch_receipt')`,
        'order by created_at desc, id desc',
        'limit 8;',
      ].join(' '),
    )
    const doneAudit = doneAuditForTask(detailDbPath, task.id, task.status)
    const shipping = parseShippingGovernorMeta(task.body ?? null)
    const controlReceipts = events
      .map((event) => parseControlReceipt(event))
      .filter((event): event is SwarmKanbanControlReceipt => Boolean(event))
    return {
      id: task.id,
      board: resolved.slug,
      title: task.title,
      status: task.status ?? 'unknown',
      lane: mapStatusToLane(task.status),
      assignee: task.assignee ?? null,
      createdBy: task.created_by ?? null,
      body: task.body ?? '',
      result: task.result ?? null,
      latestSummary: task.latest_summary ?? task.result ?? null,
      workspaceKind: task.workspace_kind ?? null,
      workspacePath: task.workspace_path ?? null,
      currentRunId: task.current_run_id ?? null,
      createdAt: normalizeTimestamp(task.created_at),
      startedAt: normalizeTimestamp(task.started_at),
      completedAt: normalizeTimestamp(task.completed_at),
      comments: comments.map((comment) => ({
        author: comment.author ?? null,
        body: comment.body ?? '',
        createdAt: normalizeTimestamp(comment.created_at),
      })),
      recentRuns: recentRuns.map((run) => ({
        id: run.id,
        status: run.status ?? null,
        outcome: run.outcome ?? null,
        summary: run.summary ?? null,
        metadata: run.metadata ?? null,
        error: run.error ?? null,
        startedAt: normalizeTimestamp(run.started_at),
        endedAt: normalizeTimestamp(run.ended_at),
      })),
      acceptance: summarizeAcceptance(findTaskAcceptance(input.taskId, resolved.slug)),
      controlReceipts,
      doneAudit,
      shipping,
    }
  }

  if (getCapabilities().kanban) {
    const task = await fetchDashboardKanbanTask(input.taskId, resolved.slug)
    if (!task) return null
    return {
      id: task.id,
      board: resolved.slug,
      title: task.title,
      status: task.status,
      lane: mapStatusToLane(task.status),
      assignee: task.assignee ?? null,
      createdBy: task.created_by ?? null,
      body: task.body ?? '',
      result: null,
      latestSummary: task.latest_summary ?? null,
      workspaceKind: task.workspace_kind ?? null,
      workspacePath: task.workspace_path ?? null,
      currentRunId: null,
      createdAt: normalizeTimestamp(task.created_at),
      startedAt: normalizeTimestamp(task.started_at),
      completedAt: normalizeTimestamp(task.completed_at),
      comments: [],
      recentRuns: [],
      acceptance: null,
      controlReceipts: [],
      doneAudit: null,
      shipping: parseShippingGovernorMeta(task.body ?? null),
    }
  }

  const card = listSwarmKanbanCards().find((entry) => entry.id === input.taskId)
  if (!card) return null
  return {
    id: card.id,
    board: resolved.slug,
    title: card.title,
    status: card.status,
    lane: card.status,
    assignee: card.assignedWorker,
    createdBy: card.createdBy,
    body: card.spec,
    result: null,
    latestSummary: card.latestSummary ?? null,
    workspaceKind: null,
    workspacePath: SWARM_KANBAN_FILE,
    currentRunId: null,
    createdAt: card.createdAt,
    startedAt: null,
    completedAt: null,
    comments: [],
    recentRuns: [],
    acceptance: null,
    controlReceipts: [],
    doneAudit: null,
    shipping: null,
  }
}
