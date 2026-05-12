import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MATRIX_DEFAULT_BOARD_SLUG } from '../lib/matrix-branding'
import { getClaudeRoot } from './claude-paths'

type StatusCounts = Record<string, number>
type BlockerClass =
  | 'human_approval'
  | 'runtime_worker_crash'
  | 'push_deploy_follow_through'
  | 'external_live_boundary'
  | 'backlog_triage'
  | 'other_open'

export type MatrixAttentionTask = {
  id: string
  title: string
  status: string | null
  assignee: string | null
  tenant: string | null
  priority: number | null
  blockerClass: BlockerClass
  blockerClassLabel: string
  blockReason: string
  contextSnippet: string
  board: string
}

export type MatrixDoneWithOpenChild = {
  parentId: string
  parentTitle: string
  childId: string
  childTitle: string
  childStatus: string | null
  childAssignee: string | null
  board: string
}

export type MatrixAttentionAction = {
  id: string
  tone: 'warn' | 'neutral' | 'good'
  action: 'route_non_human_blockers' | 'promote_or_park_backlog' | 'review_follow_up' | 'review_test_demo_cleanup'
  label: string
  rationale: string
  board: string | null
  taskIds: Array<string>
  taskPreview: Array<{ id: string; title: string; status: string | null; board: string }>
  requiresHuman: boolean
}

export type MatrixAttentionBoardSnapshot = {
  board: string
  db: string
  available: boolean
  error?: string
  statusCounts: StatusCounts
  openTaskCount: number
  openWorkCount: number
  backlogCount: number
  humanApprovalCount: number
  nonHumanBlockedCount: number
  doneWithOpenChildCount: number
  zeroReady: boolean
  zeroRunning: boolean
  zeroReadyOpenWork: boolean
  autonomyDeadlock: boolean
  blockedClassCounts: Partial<Record<BlockerClass, number>>
  classifiedOpenTasks: Array<MatrixAttentionTask>
  doneWithOpenChildren: Array<MatrixDoneWithOpenChild>
  testDemoTaskCandidates: Array<MatrixAttentionTask>
}

export type MatrixAttentionSnapshot = {
  checkedAt: number
  available: boolean
  controlPlane: 'the-matrix'
  storage: 'hermes-kanban'
  boardCount: number
  boards: Array<MatrixAttentionBoardSnapshot>
  totalStatusCounts: StatusCounts
  blockedClassCounts: Partial<Record<BlockerClass, number>>
  openTaskCount: number
  openWorkCount: number
  backlogCount: number
  doneWithOpenChildCount: number
  nonHumanBlockedCount: number
  humanApprovalBlockedCount: number
  zeroReady: boolean
  zeroRunning: boolean
  zeroReadyOpenWork: boolean
  autonomyDeadlock: boolean
  autonomyDeadlockBoards: Array<string>
  classifiedOpenTaskPreview: Array<MatrixAttentionTask>
  doneWithOpenChildPreview: Array<MatrixDoneWithOpenChild>
  testDemoTaskCandidateCount: number
  testDemoTaskPreview: Array<MatrixAttentionTask>
  attentionItems: Array<{ tone: 'warn' | 'neutral' | 'good'; text: string }>
  suggestedActions: Array<MatrixAttentionAction>
}

type SqliteTaskRow = {
  id: string
  title?: string | null
  status?: string | null
  assignee?: string | null
  tenant?: string | null
  priority?: number | string | null
  body?: string | null
  result?: string | null
}

type SqliteEventRow = { payload?: string | null }
type SqliteCommentRow = { body?: string | null }
type SqliteStatusRow = { status?: string | null; count?: number | string | null }
type SqliteDoneChildRow = {
  parent_id: string
  parent_title?: string | null
  child_id: string
  child_title?: string | null
  child_status?: string | null
  child_assignee?: string | null
}

const BLOCKER_CLASS_LABELS: Record<BlockerClass, string> = {
  human_approval: 'human approval',
  runtime_worker_crash: 'runtime/worker crash',
  push_deploy_follow_through: 'push/deploy follow-through',
  external_live_boundary: 'external/live boundary',
  backlog_triage: 'backlog triage',
  other_open: 'other open work',
}

const APPROVAL_PATTERNS = [/approval needed/i, /go[/-]?no[/-]?go/i, /wait for stig/i, /human approval/i, /approve or reject/i, /explicit approval/i]
const PUSH_DEPLOY_PATTERNS = [/git push/i, /push access/i, /repo permissions/i, /permission to .* denied/i, /landing path/i, /upstream\/push/i]
const RUNTIME_CRASH_PATTERNS = [/pid .* not alive/i, /protocol violation/i, /crash blocker/i, /worker protocol/i, /spawn_failed/i, /timed out/i, /\bcrash(?:ed)?\b/i, /gave[_ -]?up/i]
const EXTERNAL_LIVE_PATTERNS = [/vectorworks/i, /live boundary/i, /actual .*workstation/i, /actual machine/i, /host bridge/i, /customer-facing/i, /external action remains blocked/i, /needs actual/i]
const TEST_DEMO_TITLE_PATTERNS = [/^(test|demo|dummy)(\s|[-_:])/i, /\b(test|demo|dummy|fixture|sample|smoke)(\b|[-_:])/i]

function sqliteJson<T>(dbPath: string, sql: string): T {
  const raw = execFileSync('sqlite3', [dbPath, '-json', sql], { encoding: 'utf8', timeout: 15_000 }).trim()
  return (raw ? JSON.parse(raw) : []) as T
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function hasTable(dbPath: string, table: string): boolean {
  const rows = sqliteJson<Array<{ name: string }>>(dbPath, `select name from sqlite_master where type='table' and name=${sqlString(table)}`)
  return rows.length > 0
}

function hermesBoardRoot(): string {
  return join(getClaudeRoot(), 'kanban', 'boards')
}

function rootKanbanDbPath(): string {
  return join(getClaudeRoot(), 'kanban.db')
}

function boardLabel(slug: string): string {
  if (slug === MATRIX_DEFAULT_BOARD_SLUG) return 'The Matrix'
  if (slug === 'default') return 'Root board'
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function discoverAttentionBoards(): Array<{ slug: string; label: string; dbPath: string }> {
  const boards: Array<{ slug: string; label: string; dbPath: string }> = []
  const rootDb = rootKanbanDbPath()
  if (existsSync(rootDb)) boards.push({ slug: 'default', label: boardLabel('default'), dbPath: rootDb })
  const boardRoot = hermesBoardRoot()
  if (existsSync(boardRoot)) {
    for (const entry of readdirSync(boardRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dbPath = join(boardRoot, entry.name, 'kanban.db')
      if (existsSync(dbPath)) boards.push({ slug: entry.name, label: boardLabel(entry.name), dbPath })
    }
  }
  return boards
}

function normalizeText(parts: Array<string | null | undefined>): string {
  return parts.join(' ').toLowerCase().split(/\s+/).filter(Boolean).join(' ')
}

function parsePayloadReason(payload: string | null | undefined): string {
  if (!payload?.trim()) return ''
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>
    const reason = parsed.reason ?? parsed.summary
    return typeof reason === 'string' ? reason.trim() : ''
  } catch {
    return ''
  }
}

function latestBlockReason(dbPath: string, taskId: string): string {
  if (!hasTable(dbPath, 'task_events')) return ''
  const rows = sqliteJson<Array<SqliteEventRow>>(dbPath, `select payload from task_events where task_id=${sqlString(taskId)} and kind='blocked' order by id desc limit 3`)
  for (const row of rows) {
    const reason = parsePayloadReason(row.payload)
    if (reason) return reason
  }
  return ''
}

function recentCommentExcerpt(dbPath: string, taskId: string): string {
  if (!hasTable(dbPath, 'task_comments')) return ''
  const rows = sqliteJson<Array<SqliteCommentRow>>(dbPath, `select body from task_comments where task_id=${sqlString(taskId)} order by id desc limit 3`)
  return rows.map((row) => row.body?.trim()).filter(Boolean).join('\n')
}

function isTestDemoTaskCandidate(row: SqliteTaskRow): boolean {
  const title = row.title ?? ''
  return TEST_DEMO_TITLE_PATTERNS.some((pattern) => pattern.test(title))
}

function actionPreview(tasks: Array<MatrixAttentionTask>): MatrixAttentionAction['taskPreview'] {
  return tasks.slice(0, 5).map((task) => ({ id: task.id, title: task.title, status: task.status, board: task.board }))
}

function classifyOpenTask(status: string | null | undefined, text: string): BlockerClass {
  const lowerStatus = (status ?? '').trim().toLowerCase()
  if (lowerStatus === 'todo' || lowerStatus === 'triage' || lowerStatus === 'ready') return 'backlog_triage'
  if (APPROVAL_PATTERNS.some((pattern) => pattern.test(text))) return 'human_approval'
  if (PUSH_DEPLOY_PATTERNS.some((pattern) => pattern.test(text))) return 'push_deploy_follow_through'
  if (RUNTIME_CRASH_PATTERNS.some((pattern) => pattern.test(text))) return 'runtime_worker_crash'
  if (EXTERNAL_LIVE_PATTERNS.some((pattern) => pattern.test(text))) return 'external_live_boundary'
  return 'other_open'
}

function classifyTask(dbPath: string, board: string, row: SqliteTaskRow): MatrixAttentionTask {
  const reason = latestBlockReason(dbPath, row.id)
  const comments = recentCommentExcerpt(dbPath, row.id)
  const text = normalizeText([row.title, reason, comments, row.result])
  const blockerClass = classifyOpenTask(row.status, text)
  const snippetSource = reason || comments || row.title || ''
  return {
    id: row.id,
    title: row.title ?? row.id,
    status: row.status ?? null,
    assignee: row.assignee ?? null,
    tenant: row.tenant ?? null,
    priority: row.priority == null ? null : Number(row.priority),
    blockerClass,
    blockerClassLabel: BLOCKER_CLASS_LABELS[blockerClass],
    blockReason: reason,
    contextSnippet: snippetSource.split(/\s+/).join(' ').slice(0, 240),
    board,
  }
}

function emptyBoardSnapshot(board: string, dbPath: string, extra?: Partial<MatrixAttentionBoardSnapshot>): MatrixAttentionBoardSnapshot {
  return {
    board,
    db: dbPath,
    available: true,
    statusCounts: {},
    openTaskCount: 0,
    openWorkCount: 0,
    backlogCount: 0,
    humanApprovalCount: 0,
    nonHumanBlockedCount: 0,
    doneWithOpenChildCount: 0,
    zeroReady: true,
    zeroRunning: true,
    zeroReadyOpenWork: false,
    autonomyDeadlock: false,
    blockedClassCounts: {},
    classifiedOpenTasks: [],
    doneWithOpenChildren: [],
    testDemoTaskCandidates: [],
    ...extra,
  }
}

export function boardAttentionSnapshot(dbPath: string, board: string, limit = 8): MatrixAttentionBoardSnapshot {
  try {
    if (!hasTable(dbPath, 'tasks')) return emptyBoardSnapshot(board, dbPath)
    const statusRows = sqliteJson<Array<SqliteStatusRow>>(dbPath, 'select status, count(*) as count from tasks group by status')
    const statusCounts: StatusCounts = {}
    for (const row of statusRows) statusCounts[String(row.status ?? '')] = Number(row.count ?? 0)

    const openCountRows = sqliteJson<Array<{ count: number | string }>>(dbPath, "select count(*) as count from tasks where status not in ('done', 'archived', 'cancelled')")
    const openTaskCount = Number(openCountRows[0]?.count ?? 0)
    const openRows = sqliteJson<Array<SqliteTaskRow>>(dbPath, `
      select id, title, status, assignee, tenant, priority, body, result
      from tasks
      where status not in ('done', 'archived', 'cancelled')
      order by case status
        when 'blocked' then 0
        when 'todo' then 1
        when 'ready' then 2
        when 'triage' then 3
        when 'running' then 4
        else 5 end,
        priority desc,
        created_at desc
      limit ${Number(limit) || 8}
    `)
    const classifiedOpenTasks = openRows.map((row) => classifyTask(dbPath, board, row))

    const allClassRows = sqliteJson<Array<SqliteTaskRow>>(dbPath, `
      select id, title, status, assignee, tenant, priority, body, result
      from tasks
      where status in ('blocked', 'todo', 'ready', 'triage')
      order by priority desc, created_at desc
    `)
    const testDemoRows = sqliteJson<Array<SqliteTaskRow>>(dbPath, `
      select id, title, status, assignee, tenant, priority, body, result
      from tasks
      where status not in ('archived', 'cancelled')
      order by created_at desc
      limit 500
    `)
    const testDemoTaskCandidates = testDemoRows
      .filter(isTestDemoTaskCandidate)
      .map((row) => classifyTask(dbPath, board, row))

    const blockedClassCounts: Partial<Record<BlockerClass, number>> = {}
    for (const row of allClassRows) {
      const classified = classifyTask(dbPath, board, row)
      blockedClassCounts[classified.blockerClass] = (blockedClassCounts[classified.blockerClass] ?? 0) + 1
    }

    let doneWithOpenChildren: Array<MatrixDoneWithOpenChild> = []
    let doneWithOpenChildCount = 0
    if (hasTable(dbPath, 'task_links')) {
      const totalRows = sqliteJson<Array<{ count: number | string }>>(dbPath, `
        select count(*) as count
        from task_links l
        join tasks p on p.id = l.parent_id
        join tasks c on c.id = l.child_id
        where p.status = 'done' and c.status not in ('done', 'archived', 'cancelled')
      `)
      doneWithOpenChildCount = Number(totalRows[0]?.count ?? 0)
      const childRows = sqliteJson<Array<SqliteDoneChildRow>>(dbPath, `
        select p.id as parent_id, p.title as parent_title,
               c.id as child_id, c.title as child_title, c.status as child_status, c.assignee as child_assignee
        from task_links l
        join tasks p on p.id = l.parent_id
        join tasks c on c.id = l.child_id
        where p.status = 'done' and c.status not in ('done', 'archived', 'cancelled')
        order by p.completed_at desc
        limit ${Number(limit) || 8}
      `)
      doneWithOpenChildren = childRows.map((row) => ({
        parentId: row.parent_id,
        parentTitle: row.parent_title ?? row.parent_id,
        childId: row.child_id,
        childTitle: row.child_title ?? row.child_id,
        childStatus: row.child_status ?? null,
        childAssignee: row.child_assignee ?? null,
        board,
      }))
    }

    const readyCount = Number(statusCounts.ready ?? 0)
    const runningCount = Number(statusCounts.running ?? 0)
    const backlogCount = Number(statusCounts.todo ?? 0) + Number(statusCounts.triage ?? 0) + readyCount
    const humanApprovalCount = Number(blockedClassCounts.human_approval ?? 0)
    const nonHumanBlockedCount = Object.entries(blockedClassCounts).reduce((sum, [key, count]) => {
      return key === 'human_approval' || key === 'backlog_triage' ? sum : sum + Number(count ?? 0)
    }, 0)
    const openWorkCount = Number(statusCounts.blocked ?? 0) + Number(statusCounts.todo ?? 0) + Number(statusCounts.triage ?? 0) + readyCount
    const zeroReady = readyCount === 0
    const zeroRunning = runningCount === 0
    const zeroReadyOpenWork = zeroReady && openWorkCount > 0
    const autonomyDeadlock = zeroReadyOpenWork && (nonHumanBlockedCount > 0 || backlogCount > 0 || doneWithOpenChildCount > 0)

    return {
      board,
      db: dbPath,
      available: true,
      statusCounts,
      openTaskCount,
      openWorkCount,
      backlogCount,
      humanApprovalCount,
      nonHumanBlockedCount,
      doneWithOpenChildCount,
      zeroReady,
      zeroRunning,
      zeroReadyOpenWork,
      autonomyDeadlock,
      blockedClassCounts,
      classifiedOpenTasks,
      doneWithOpenChildren,
      testDemoTaskCandidates,
    }
  } catch (error) {
    return emptyBoardSnapshot(board, dbPath, { available: false, error: error instanceof Error ? error.message : String(error) })
  }
}

export function getMatrixAttentionSnapshot(limit = 8): MatrixAttentionSnapshot {
  const boards = discoverAttentionBoards().map((board) => boardAttentionSnapshot(board.dbPath, board.label, limit))
  const totalStatusCounts: StatusCounts = {}
  const blockedClassCounts: Partial<Record<BlockerClass, number>> = {}
  let openTaskCount = 0
  let openWorkCount = 0
  let doneWithOpenChildCount = 0
  let nonHumanBlockedCount = 0
  let humanApprovalBlockedCount = 0
  let backlogCount = 0
  const autonomyDeadlockBoards: Array<string> = []
  let testDemoTaskCandidateCount = 0

  for (const board of boards) {
    if (!board.available) continue
    for (const [status, count] of Object.entries(board.statusCounts)) totalStatusCounts[status] = (totalStatusCounts[status] ?? 0) + Number(count ?? 0)
    for (const [key, count] of Object.entries(board.blockedClassCounts)) {
      const blockerKey = key as BlockerClass
      blockedClassCounts[blockerKey] = (blockedClassCounts[blockerKey] ?? 0) + Number(count ?? 0)
    }
    openTaskCount += board.openTaskCount
    openWorkCount += board.openWorkCount
    doneWithOpenChildCount += board.doneWithOpenChildCount
    nonHumanBlockedCount += board.nonHumanBlockedCount
    humanApprovalBlockedCount += board.humanApprovalCount
    backlogCount += board.backlogCount
    testDemoTaskCandidateCount += board.testDemoTaskCandidates.length
    if (board.autonomyDeadlock) autonomyDeadlockBoards.push(board.board)
  }

  const zeroReady = Number(totalStatusCounts.ready ?? 0) === 0
  const zeroRunning = Number(totalStatusCounts.running ?? 0) === 0
  const zeroReadyOpenWork = zeroReady && openWorkCount > 0
  const autonomyDeadlock = autonomyDeadlockBoards.length > 0
  const classifiedOpenTaskPreview = boards.flatMap((board) => board.classifiedOpenTasks).slice(0, 5)
  const doneWithOpenChildPreview = boards.flatMap((board) => board.doneWithOpenChildren).slice(0, 5)
  const testDemoTaskPreview = boards.flatMap((board) => board.testDemoTaskCandidates).slice(0, 8)
  const attentionItems: MatrixAttentionSnapshot['attentionItems'] = []
  const suggestedActions: Array<MatrixAttentionAction> = []

  if (autonomyDeadlock) {
    attentionItems.push({ tone: 'warn', text: `Autonomy deadlock: ${autonomyDeadlockBoards.join(', ')} has open work but no ready task` })
  } else if (zeroReadyOpenWork) {
    attentionItems.push({ tone: 'neutral', text: 'Open Kanban work exists, but no ready tasks are queued' })
  }
  if (nonHumanBlockedCount > 0) attentionItems.push({ tone: 'warn', text: `${nonHumanBlockedCount} non-human blockers need routing` })
  if (doneWithOpenChildCount > 0) attentionItems.push({ tone: 'warn', text: `${doneWithOpenChildCount} done slices still have open follow-up` })
  if (backlogCount > 0 && zeroReady) attentionItems.push({ tone: 'neutral', text: `${backlogCount} backlog/triage items need promotion or parking` })
  if (testDemoTaskCandidateCount > 0) attentionItems.push({ tone: 'neutral', text: `${testDemoTaskCandidateCount} likely test/demo tasks should be reviewed for archive/parking` })

  const nonHumanTasks = boards.flatMap((board) => board.classifiedOpenTasks.filter((task) => !['human_approval', 'backlog_triage'].includes(task.blockerClass)))
  if (nonHumanTasks.length > 0) {
    suggestedActions.push({
      id: 'route-non-human-blockers',
      tone: 'warn',
      action: 'route_non_human_blockers',
      label: 'Route non-human blockers',
      rationale: 'These blockers look like runtime, deploy, or external-machine failures, not decisions Stig must make.',
      board: null,
      taskIds: nonHumanTasks.map((task) => task.id),
      taskPreview: actionPreview(nonHumanTasks),
      requiresHuman: false,
    })
  }
  const backlogTasks = boards.flatMap((board) => board.classifiedOpenTasks.filter((task) => task.blockerClass === 'backlog_triage'))
  if (backlogTasks.length > 0 && zeroReady) {
    suggestedActions.push({
      id: 'promote-or-park-backlog',
      tone: 'neutral',
      action: 'promote_or_park_backlog',
      label: 'Promote or park backlog/triage',
      rationale: 'There is open backlog/triage work, but no ready task for the dispatcher.',
      board: null,
      taskIds: backlogTasks.map((task) => task.id),
      taskPreview: actionPreview(backlogTasks),
      requiresHuman: false,
    })
  }
  if (doneWithOpenChildPreview.length > 0) {
    suggestedActions.push({
      id: 'review-open-follow-up',
      tone: 'warn',
      action: 'review_follow_up',
      label: 'Review open follow-up from done slices',
      rationale: 'These parents are done only as scoped slices; linked children still need routing, acceptance, or explicit parking.',
      board: null,
      taskIds: doneWithOpenChildPreview.map((item) => item.childId),
      taskPreview: doneWithOpenChildPreview.map((item) => ({ id: item.childId, title: item.childTitle, status: item.childStatus, board: item.board })),
      requiresHuman: false,
    })
  }
  if (testDemoTaskPreview.length > 0) {
    suggestedActions.push({
      id: 'review-test-demo-cleanup',
      tone: 'neutral',
      action: 'review_test_demo_cleanup',
      label: 'Review likely test/demo tasks',
      rationale: 'These look synthetic by title/body markers. Matrix should suggest archive/parking, not silently mutate them.',
      board: null,
      taskIds: testDemoTaskPreview.map((task) => task.id),
      taskPreview: actionPreview(testDemoTaskPreview),
      requiresHuman: true,
    })
  }
  if (attentionItems.length === 0) attentionItems.push({ tone: 'good', text: 'Kanban attention clear' })

  return {
    checkedAt: Date.now(),
    available: boards.length > 0,
    controlPlane: 'the-matrix',
    storage: 'hermes-kanban',
    boardCount: boards.length,
    boards,
    totalStatusCounts,
    blockedClassCounts,
    openTaskCount,
    openWorkCount,
    backlogCount,
    doneWithOpenChildCount,
    nonHumanBlockedCount,
    humanApprovalBlockedCount,
    zeroReady,
    zeroRunning,
    zeroReadyOpenWork,
    autonomyDeadlock,
    autonomyDeadlockBoards,
    classifiedOpenTaskPreview,
    doneWithOpenChildPreview,
    testDemoTaskCandidateCount,
    testDemoTaskPreview,
    attentionItems,
    suggestedActions,
  }
}
