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

export const SHIPPING_STATES = ['idea', 'candidate', 'active_build', 'shipped', 'parked', 'killed'] as const
export const ACTIVE_SLOT_TYPES = ['build', 'research_plan', 'none'] as const
export const SHIPPING_ACTIVE_BUILD_LIMIT = 2
export const SHIPPING_RESEARCH_PLAN_LIMIT = 3

export type ShippingState = (typeof SHIPPING_STATES)[number]
export type ActiveSlotType = (typeof ACTIVE_SLOT_TYPES)[number]

export type ShippingGovernorMeta = {
  shippingState: ShippingState | null
  activeSlotType: ActiveSlotType | null
  ownerLane: string | null
  acceptanceCriteria: string | null
  doneDefinition: string | null
  dummyOrNoSecretsPlan: string | null
  codexAcpSpecReady: 'true' | 'false' | 'n/a' | null
  displacesOrParks: string | null
  lastShippingReviewAt: string | null
}

export type ShippingGovernorSummary = {
  activeBuildCount: number
  activeBuildLimit: number
  activeResearchPlanCount: number
  activeResearchPlanLimit: number
  candidateCount: number
  ideaCount: number
  parkedCount: number
  killedCount: number
  shippedCount: number
  overActiveBuildLimit: boolean
  overResearchPlanLimit: boolean
  warnings: Array<string>
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

export function parseKeyValueTextBlock(value: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (const line of value.split(/\r?\n/)) {
    const match = line.match(/^\s*([a-z0-9_]+)\s*:\s*(.*?)\s*$/i)
    if (!match) continue
    const key = match[1]?.trim().toLowerCase()
    const text = match[2]?.trim()
    if (key && text) parsed[key] = text
  }
  return parsed
}

export function parseAcceptanceText(value: string): SwarmTaskAcceptance | null {
  const parsed: Partial<Record<AcceptanceField, string>> = {}
  const keyValues = parseKeyValueTextBlock(value)
  for (const field of ACCEPTANCE_FIELDS) {
    const text = keyValues[field]?.trim()
    if (text) parsed[field] = text
  }
  return parseAcceptanceMetadata(parsed)
}

function normalizeEnumValue(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return normalized || null
}

function parseShippingState(value: string | null | undefined): ShippingState | null {
  const normalized = normalizeEnumValue(value)
  return normalized && SHIPPING_STATES.includes(normalized as ShippingState) ? (normalized as ShippingState) : null
}

function parseActiveSlotType(value: string | null | undefined): ActiveSlotType | null {
  const normalized = normalizeEnumValue(value)
  return normalized && ACTIVE_SLOT_TYPES.includes(normalized as ActiveSlotType) ? (normalized as ActiveSlotType) : null
}

function parseSpecReady(value: string | null | undefined): ShippingGovernorMeta['codexAcpSpecReady'] {
  const normalized = normalizeEnumValue(value)
  if (normalized === 'true' || normalized === 'false' || normalized === 'n/a') return normalized
  return null
}

function nullableText(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function emptyShippingGovernorSummary(): ShippingGovernorSummary {
  return {
    activeBuildCount: 0,
    activeBuildLimit: SHIPPING_ACTIVE_BUILD_LIMIT,
    activeResearchPlanCount: 0,
    activeResearchPlanLimit: SHIPPING_RESEARCH_PLAN_LIMIT,
    candidateCount: 0,
    ideaCount: 0,
    parkedCount: 0,
    killedCount: 0,
    shippedCount: 0,
    overActiveBuildLimit: false,
    overResearchPlanLimit: false,
    warnings: [],
  }
}

function buildShippingGovernorWarnings(summary: ShippingGovernorSummary): Array<string> {
  const warnings: Array<string> = []
  if (summary.activeBuildCount > summary.activeBuildLimit) {
    warnings.push(`Active Build limit exceeded (${summary.activeBuildCount}/${summary.activeBuildLimit}). Park/finish another build or record Stig override before routing more build work.`)
  } else if (summary.activeBuildCount === summary.activeBuildLimit) {
    warnings.push(`Active Build limit reached (${summary.activeBuildCount}/${summary.activeBuildLimit}). Routing another build will exceed the portfolio guardrail.`)
  }
  if (summary.activeResearchPlanCount > summary.activeResearchPlanLimit) {
    warnings.push(`Research/Planning limit exceeded (${summary.activeResearchPlanCount}/${summary.activeResearchPlanLimit}). Park or finish a research/planning track before starting more.`)
  } else if (summary.activeResearchPlanCount === summary.activeResearchPlanLimit) {
    warnings.push(`Research/Planning limit reached (${summary.activeResearchPlanCount}/${summary.activeResearchPlanLimit}). Another research/planning track will exceed the guardrail.`)
  }
  return warnings
}

export function parseShippingGovernorMeta(value: string | null | undefined): ShippingGovernorMeta | null {
  if (!value?.trim()) return null
  const parsed = parseKeyValueTextBlock(value)
  const meta: ShippingGovernorMeta = {
    shippingState: parseShippingState(parsed.shipping_state),
    activeSlotType: parseActiveSlotType(parsed.active_slot_type),
    ownerLane: nullableText(parsed.owner_lane),
    acceptanceCriteria: nullableText(parsed.acceptance_criteria),
    doneDefinition: nullableText(parsed.done_definition),
    dummyOrNoSecretsPlan: nullableText(parsed.dummy_or_no_secrets_plan),
    codexAcpSpecReady: parseSpecReady(parsed.codex_acp_spec_ready),
    displacesOrParks: nullableText(parsed.displaces_or_parks),
    lastShippingReviewAt: nullableText(parsed.last_shipping_review_at),
  }
  return Object.values(meta).some((entry) => entry !== null) ? meta : null
}

export function summarizeShippingGovernorPortfolio(items: Array<ShippingGovernorMeta | null | undefined>): ShippingGovernorSummary {
  const summary = emptyShippingGovernorSummary()
  for (const item of items) {
    if (!item) continue
    if (item.shippingState === 'idea') summary.ideaCount += 1
    if (item.shippingState === 'candidate') summary.candidateCount += 1
    if (item.shippingState === 'parked') summary.parkedCount += 1
    if (item.shippingState === 'killed') summary.killedCount += 1
    if (item.shippingState === 'shipped') summary.shippedCount += 1
    if (item.shippingState === 'active_build' && item.activeSlotType === 'build') summary.activeBuildCount += 1
    if (item.activeSlotType === 'research_plan') summary.activeResearchPlanCount += 1
  }
  summary.overActiveBuildLimit = summary.activeBuildCount > summary.activeBuildLimit
  summary.overResearchPlanLimit = summary.activeResearchPlanCount > summary.activeResearchPlanLimit
  summary.warnings = buildShippingGovernorWarnings(summary)
  return summary
}

export function mergeShippingGovernorSummaries(summaries: Array<ShippingGovernorSummary | null | undefined>): ShippingGovernorSummary {
  const merged = emptyShippingGovernorSummary()
  for (const summary of summaries) {
    if (!summary) continue
    merged.activeBuildCount += summary.activeBuildCount
    merged.activeResearchPlanCount += summary.activeResearchPlanCount
    merged.candidateCount += summary.candidateCount
    merged.ideaCount += summary.ideaCount
    merged.parkedCount += summary.parkedCount
    merged.killedCount += summary.killedCount
    merged.shippedCount += summary.shippedCount
  }
  merged.overActiveBuildLimit = merged.activeBuildCount > merged.activeBuildLimit
  merged.overResearchPlanLimit = merged.activeResearchPlanCount > merged.activeResearchPlanLimit
  merged.warnings = buildShippingGovernorWarnings(merged)
  return merged
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
