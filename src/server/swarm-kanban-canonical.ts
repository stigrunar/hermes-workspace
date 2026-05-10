import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { MATRIX_DEFAULT_BOARD_SLUG } from '../lib/matrix-branding'
import { getClaudeRoot } from './claude-paths'

export const ACCEPTANCE_FIELDS = [
  'accepted_by',
  'accepted_at',
  'lane',
  'scope_understood',
  'first_action',
  'expected_artifact',
  'risk_level',
  'will_not_do',
] as const

export type AcceptanceField = (typeof ACCEPTANCE_FIELDS)[number]

export type SwarmTaskAcceptance = Record<AcceptanceField, string>

export type CanonicalTaskRow = {
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
}

type CanonicalCommentRow = {
  author?: string | null
  body?: string | null
  created_at?: number | string | null
}

type CanonicalEventRow = {
  kind?: string | null
  payload?: string | null
  created_at?: number | string | null
}

export const ACCEPTANCE_COMMENT_PREFIX = 'SPECIALIST_ACCEPTANCE '

function rootKanbanDbPath(): string {
  return path.join(getClaudeRoot(), 'kanban.db')
}

function hermesBoardRoot(): string {
  return path.join(getClaudeRoot(), 'kanban', 'boards')
}

function normalizeBoardSlug(input: string | null | undefined): string | null {
  const value = input?.trim().toLowerCase()
  if (!value) return null
  if (value === 'matrix' || value === 'the-matrix') return MATRIX_DEFAULT_BOARD_SLUG
  if (value === 'root' || value === 'main') return 'default'
  return value
}

function boardDbPath(slug: string): string | null {
  if (slug === 'default') {
    const root = rootKanbanDbPath()
    return fs.existsSync(root) ? root : null
  }
  const candidate = path.join(hermesBoardRoot(), slug, 'kanban.db')
  return fs.existsSync(candidate) ? candidate : null
}

export function resolveCanonicalBoardDbPath(board?: string | null): string | null {
  const requested = normalizeBoardSlug(board)
  if (requested) {
    const resolved = boardDbPath(requested)
    if (resolved) return resolved
  }
  return boardDbPath(MATRIX_DEFAULT_BOARD_SLUG) ?? boardDbPath('default')
}

export function sqliteQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function sqliteExec(dbPath: string, sql: string): string {
  return execFileSync('sqlite3', [dbPath, sql], {
    encoding: 'utf8',
    timeout: 15_000,
  }).trim()
}

export function sqliteJson<T>(dbPath: string, sql: string): T {
  const raw = execFileSync('sqlite3', [dbPath, '-json', sql], {
    encoding: 'utf8',
    timeout: 15_000,
  }).trim()
  return (raw ? JSON.parse(raw) : []) as T
}

export function loadCanonicalTask(taskId: string, board?: string | null): { dbPath: string; task: CanonicalTaskRow } | null {
  const dbPath = resolveCanonicalBoardDbPath(board)
  if (!dbPath) return null
  const safeTaskId = taskId.replace(/'/g, "''")
  const rows = sqliteJson<Array<CanonicalTaskRow>>(
    dbPath,
    [
      'select id, title, body, assignee, status, created_by, created_at, started_at, completed_at, workspace_kind, workspace_path, current_run_id, result',
      'from tasks',
      `where id = '${safeTaskId}'`,
      'limit 1;',
    ].join(' '),
  )
  const task = rows[0]
  return task ? { dbPath, task } : null
}

export function appendCanonicalComment(input: {
  dbPath: string
  taskId: string
  author: string
  body: string
  createdAt?: number
}): void {
  const createdAt = input.createdAt ?? Math.floor(Date.now() / 1000)
  sqliteExec(
    input.dbPath,
    [
      'insert into task_comments (task_id, author, body, created_at) values (',
      sqliteQuote(input.taskId),
      ',',
      sqliteQuote(input.author),
      ',',
      sqliteQuote(input.body),
      ',',
      String(createdAt),
      ');',
    ].join(' '),
  )
}

export function appendCanonicalEvent(input: {
  dbPath: string
  taskId: string
  kind: string
  payload?: unknown
  runId?: number | null
  createdAt?: number
}): void {
  const createdAt = input.createdAt ?? Math.floor(Date.now() / 1000)
  const payload = input.payload === undefined ? 'NULL' : sqliteQuote(JSON.stringify(input.payload))
  const runId = typeof input.runId === 'number' ? String(input.runId) : 'NULL'
  sqliteExec(
    input.dbPath,
    [
      'insert into task_events (task_id, run_id, kind, payload, created_at) values (',
      sqliteQuote(input.taskId),
      ',',
      runId,
      ',',
      sqliteQuote(input.kind),
      ',',
      payload,
      ',',
      String(createdAt),
      ');',
    ].join(' '),
  )
}

export function linkCanonicalTasks(input: {
  dbPath: string
  parentTaskId: string
  childTaskId: string
}): void {
  sqliteExec(
    input.dbPath,
    [
      'insert or ignore into task_links (parent_id, child_id) values (',
      sqliteQuote(input.parentTaskId),
      ',',
      sqliteQuote(input.childTaskId),
      ');',
    ].join(' '),
  )
}

export function wakeBlockedTaskOnComment(input: {
  dbPath: string
  taskId: string
  actor: string
  mutationId: string
  reason?: string | null
}): boolean {
  const changed = sqliteExec(
    input.dbPath,
    [
      'update tasks set status = \'ready\', current_run_id = NULL',
      'where id =',
      sqliteQuote(input.taskId),
      "and status = 'blocked'",
      'returning id;',
    ].join(' '),
  )
  if (!changed.trim()) return false
  appendCanonicalEvent({
    dbPath: input.dbPath,
    taskId: input.taskId,
    kind: 'comment_woke_blocked_task',
    payload: {
      mutationId: input.mutationId,
      actor: input.actor,
      reason: input.reason ?? null,
      stateAfter: 'ready',
      source: 'matrix-comment',
    },
  })
  return true
}

export function createMutationId(): string {
  return `mx_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

export function parseAcceptanceMetadata(value: unknown): SwarmTaskAcceptance | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const next = {} as SwarmTaskAcceptance
  for (const field of ACCEPTANCE_FIELDS) {
    const raw = record[field]
    if (typeof raw !== 'string' || raw.trim().length === 0) return null
    next[field] = raw.trim()
  }
  return next
}

export function parseAcceptanceText(value: string): SwarmTaskAcceptance | null {
  const parsed: Partial<Record<AcceptanceField, string>> = {}
  for (const line of value.split(/\r?\n/)) {
    const match = line.match(/^\s*([a-z_]+)\s*:\s*(.*?)\s*$/)
    if (!match) continue
    const field = match[1] as AcceptanceField
    if (!ACCEPTANCE_FIELDS.includes(field)) continue
    const text = match[2]?.trim()
    if (text) parsed[field] = text
  }
  return parseAcceptanceMetadata(parsed)
}

export function findTaskAcceptance(taskId: string, board?: string | null): SwarmTaskAcceptance | null {
  const resolved = loadCanonicalTask(taskId, board)
  if (!resolved) return null
  const safeTaskId = taskId.replace(/'/g, "''")
  const events = sqliteJson<Array<CanonicalEventRow>>(
    resolved.dbPath,
    [
      'select kind, payload, created_at',
      'from task_events',
      `where task_id = '${safeTaskId}' and kind in ('specialist_accepted', 'accepted')`,
      'order by created_at desc, id desc',
      'limit 5;',
    ].join(' '),
  )
  for (const event of events) {
    if (!event.payload) continue
    try {
      const parsed = parseAcceptanceMetadata(JSON.parse(event.payload))
      if (parsed) return parsed
    } catch {
      // ignore bad historical payloads
    }
  }
  const comments = sqliteJson<Array<CanonicalCommentRow>>(
    resolved.dbPath,
    [
      'select author, body, created_at',
      'from task_comments',
      `where task_id = '${safeTaskId}'`,
      'order by created_at desc, id desc',
      'limit 10;',
    ].join(' '),
  )
  for (const comment of comments) {
    const body = comment.body?.trim() ?? ''
    if (body.startsWith(ACCEPTANCE_COMMENT_PREFIX)) {
      try {
        const parsed = parseAcceptanceMetadata(JSON.parse(body.slice(ACCEPTANCE_COMMENT_PREFIX.length)))
        if (parsed) return parsed
      } catch {
        // ignore malformed comment payloads
      }
    }
    const parsedText = parseAcceptanceText(body)
    if (parsedText) return parsedText
  }
  return null
}

export function writeTaskAcceptance(input: {
  dbPath: string
  taskId: string
  actor: string
  acceptance: SwarmTaskAcceptance
  mutationId: string
  reason?: string | null
}): void {
  appendCanonicalComment({
    dbPath: input.dbPath,
    taskId: input.taskId,
    author: input.actor,
    body: `${ACCEPTANCE_COMMENT_PREFIX}${JSON.stringify(input.acceptance)}`,
  })
  appendCanonicalEvent({
    dbPath: input.dbPath,
    taskId: input.taskId,
    kind: 'specialist_accepted',
    payload: {
      ...input.acceptance,
      mutationId: input.mutationId,
      actor: input.actor,
      reason: input.reason ?? null,
      source: 'matrix-dispatch',
    },
  })
}
